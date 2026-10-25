// Command ayailmu-ledger is the operator tool of the deletion ledger, which a restore drill runs before anything serves
// the restored data.
//
//	ayailmu-ledger export <new ledger file>
//	ayailmu-ledger replay <ledger file>
//
// export takes its settings with config.LoadLedgerExport: the operator's database URL from its private file, the exact
// database hosts and the trusted issuer, and nothing of Auth's credentials. It reads every recorded deletion of the
// trusted provider (auth mode local-supabase, that issuer) from one read-only snapshot (store.ExportDeletionLedger)
// and writes the ledger document (store.EncodeDeletionLedger) into a new file at the given absolute path, which it
// creates for this user only (0600) and never overwrites. It prints only how many deletions the ledger carries and the
// file's SHA-256.
//
// replay takes its settings with config.LoadLedgerReplay: the database as export does, and the stack's Auth by its name
// on the internal network with the server-only admin credential from its private file. It reads the ledger from a
// private file (this user's own regular file, not a link, closed to group and others, of at most store.MaxLedgerBytes),
// decodes it strictly against the trusted provider (store.DecodeDeletionLedger) and replays it
// (store.ReplayDeletionLedger), which erases resurrected data again and keeps each account's anchor and tombstone. Only
// once that replay committed does it delete each entry's exact identity, the trusted issuer and the entry's subject
// UUID, through the real admin path (authn.SupabaseVerifier.DeleteIdentity with the server credential), even when the
// ledger records the identity's deletion as confirmed: an older Auth dump restores the identity too. Auth's precise
// user_not_found counts as confirmed. Each attempt is recorded (store.RecordIdentityAttempt), which never clears a
// confirmation. It makes one attempt per identity per run: no retry, no background work, no lookup by email, no
// password reset, and no request to Auth but those deletions.
//
// Both commands dial only the database hosts of AYA_DB_HOSTS, as pgx parsed them, and refuse a database whose schema is
// not this binary's (store.VerifySchema), which they check reading only.
//
// Exit status:
//
//	0  the export was written; or the replay committed and every identity's deletion is confirmed.
//	1  refused or failed with nothing written: a usage error, a refused setting, an unsafe or existing file, an invalid
//	   ledger or one that contradicts the database, or a replay that failed before its COMMIT and rolled back. No
//	   identity is deleted.
//	3  the replay committed, but an identity's deletion is not confirmed: Auth failed or refused, its answer was lost,
//	   the attempt could not be recorded, or an interrupted run did not make it. The tombstones stay and keep the
//	   accounts closed; the restore must not be exposed until a replay exits 0.
//	4  the replay's COMMIT failed, so whether it committed is unknown. No identity is deleted; the restore must not be
//	   exposed, and replaying the same ledger again settles it.
//
// Output names deletions and accounts by their IDs and gives every failure a fixed reason: it never quotes a subject,
// an email, a URL, a path, a password, a credential, a ledger's contents or an answer of Auth.
package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"ayailmu.local/backend/internal/authn"
	"ayailmu.local/backend/internal/config"
	"ayailmu.local/backend/internal/store"
)

// Exit statuses (the package documentation).
const (
	exitOK      = 0
	exitRefused = 1
	exitPending = 3
	exitUnknown = 4
)

const (
	// databaseTimeout bounds each command's database work: opening the database, checking its schema, and the export or
	// the replay, which may wait for the locks of the accounts it replays.
	databaseTimeout = 5 * time.Minute
	// identityStepTimeout bounds one identity's deletion at Auth and the record of that attempt.
	identityStepTimeout = 30 * time.Second
	// identityDeleted is the identity step's outcome when Auth confirmed the deletion and the record took the attempt.
	identityDeleted = "deleted"
)

// Fixed refusals, which name no path.
const (
	usageLine = "usage: ayailmu-ledger export <new ledger file> | ayailmu-ledger replay <ledger file>"
	// newLedgerRefusal refuses an export's ledger file, and privateLedgerRefusal a replay's.
	newLedgerRefusal     = "the ledger file must be a new file at an absolute path: an existing file or link is never replaced"
	privateLedgerRefusal = "the ledger file must be an absolute path to this user's own regular file, not a link, closed to group and others, of at most 2 MiB"
)

// guardErrors are refusals whose messages name a setting or give a fixed reason, and never quote a value, a path, a
// password, a subject, a ledger's contents or an answer of Auth.
var guardErrors = []error{
	config.ErrMissing, config.ErrInvalidSchema, config.ErrRealCredentials, config.ErrUnsafeSecretFile,
	config.ErrInvalidHostList, config.ErrDatabaseHostNotAllowed, config.ErrEmulatorEnvironment, config.ErrSecretInEnvironment,
	config.ErrSettingNotUsed, config.ErrInvalidAuthSetting, config.ErrAuthHostNotAllowed, authn.ErrUnsafeConfig,
	config.ErrInvalidDBTransport, store.ErrInvalidDatabaseURL, store.ErrInvalidSchema, store.ErrDatabaseHostNotAllowed,
	store.ErrDatabaseTransportInsecure, store.ErrDatabasePlaintextNotPrivate, store.ErrSchemaNotCurrent,
	store.ErrLedgerInvalid, store.ErrLedgerTooLarge, store.ErrLedgerForeignAccount, store.ErrLedgerConflict,
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	code := run(ctx, os.Args[1:], os.LookupEnv, os.Stdout, os.Stderr)
	stop()
	os.Exit(code)
}

// run is the tool, given its arguments, its settings' lookup and its outputs; it returns the exit status.
func run(ctx context.Context, args []string, lookup func(string) (string, bool), stdout, stderr io.Writer) int {
	switch {
	case len(args) == 2 && args[0] == "export":
		return exportLedger(ctx, args[1], lookup, stdout, stderr)
	case len(args) == 2 && args[0] == "replay":
		return replayLedger(ctx, args[1], lookup, stdout, stderr)
	default:
		fmt.Fprintln(stderr, usageLine)
		return exitRefused
	}
}

// exportLedger writes the ledger of every recorded deletion of the trusted provider into a new private file at path,
// reading the database only. The document is complete, and checked to decode as the trusted provider's ledger, before
// the file is created.
func exportLedger(ctx context.Context, path string, lookup func(string) (string, bool), stdout, stderr io.Writer) int {
	op, err := config.LoadLedgerExport(lookup)
	if err != nil {
		return refused(stderr, reason(err))
	}
	if !filepath.IsAbs(path) {
		return refused(stderr, newLedgerRefusal)
	}
	if _, err := os.Lstat(path); !errors.Is(err, fs.ErrNotExist) {
		return refused(stderr, newLedgerRefusal)
	}
	ctx, cancel := context.WithTimeout(ctx, databaseTimeout)
	defer cancel()
	st := openStore(ctx, op, stderr)
	if st == nil {
		return exitRefused
	}
	defer st.Close()
	anchor := store.LedgerAnchor{AuthMode: config.ModeLocalSupabase, Issuer: op.Issuer}
	l, err := st.ExportDeletionLedger(ctx, anchor)
	if err != nil {
		fmt.Fprintln(stderr, "ayailmu-ledger: the export failed, and no ledger file was written:", reason(err))
		return exitRefused
	}
	var doc bytes.Buffer
	if err := store.EncodeDeletionLedger(&doc, l); err != nil {
		fmt.Fprintln(stderr, "ayailmu-ledger: the ledger could not be encoded, and no ledger file was written:", reason(err))
		return exitRefused
	}
	if _, err := store.DecodeDeletionLedger(bytes.NewReader(doc.Bytes()), anchor); err != nil {
		fmt.Fprintln(stderr, "ayailmu-ledger: the encoded ledger does not decode, and no ledger file was written:", reason(err))
		return exitRefused
	}
	if failure := writeNewFile(path, doc.Bytes()); failure != "" {
		fmt.Fprintln(stderr, "ayailmu-ledger:", failure)
		return exitRefused
	}
	sum := sha256.Sum256(doc.Bytes())
	fmt.Fprintf(stdout, "ayailmu-ledger: exported %d deletions into a new private ledger file, sha256 %s\n", len(l.Entries),
		hex.EncodeToString(sum[:]))
	return exitOK
}

// replayLedger replays a private ledger file into the database and, only once the replay committed, deletes each
// entry's exact identity at Auth, one attempt each.
func replayLedger(ctx context.Context, path string, lookup func(string) (string, bool), stdout, stderr io.Writer) int {
	op, err := config.LoadLedgerReplay(lookup)
	if err != nil {
		return refused(stderr, reason(err))
	}
	raw, ok := readLedgerFile(path)
	if !ok {
		return refused(stderr, privateLedgerRefusal)
	}
	// Deleting an identity needs no key set. The verifier is told to fetch one, so none is configured, and none is ever
	// fetched, because nothing here verifies a token. Building it contacts nothing.
	auth, err := authn.NewSupabaseVerifier(authn.SupabaseConfig{BaseURL: op.Supabase.URL, Issuer: op.Supabase.Issuer,
		Audience: op.Supabase.Audience, FetchJWKS: true, AdminKey: op.Supabase.AdminKey, LocalSynthetic: true,
		InternalHosts: op.Supabase.AuthHosts})
	if err != nil {
		return refused(stderr, reason(err))
	}
	anchor := store.LedgerAnchor{AuthMode: config.ModeLocalSupabase, Issuer: op.Issuer}
	l, err := store.DecodeDeletionLedger(bytes.NewReader(raw), anchor)
	if err != nil {
		return refused(stderr, reason(err))
	}
	dbCtx, cancel := context.WithTimeout(ctx, databaseTimeout)
	defer cancel()
	st := openStore(dbCtx, op, stderr)
	if st == nil {
		return exitRefused
	}
	defer st.Close()
	report, err := st.ReplayDeletionLedger(dbCtx, anchor, l)
	switch {
	case errors.Is(err, store.ErrLedgerReplayFailed):
		fmt.Fprintf(stderr, "ayailmu-ledger: the replay failed before its COMMIT and rolled back (%s): nothing was erased or recorded, and nothing was asked of Auth\n",
			store.ErrorClass(err))
		return exitRefused
	case errors.Is(err, store.ErrLedgerInvalid), errors.Is(err, store.ErrLedgerConflict):
		fmt.Fprintln(stderr, "ayailmu-ledger: refusing to replay, having written nothing and asked Auth nothing:", err)
		return exitRefused
	case err != nil:
		fmt.Fprintf(stderr, "ayailmu-ledger: the replay's COMMIT failed (%s), so whether it committed is unknown; nothing was asked of Auth: keep the restore unexposed and replay the same ledger again\n",
			store.ErrorClass(err))
		return exitUnknown
	}

	subjects := make(map[string]string, len(l.Entries))
	for _, e := range l.Entries {
		subjects[e.AccountID] = e.Subject
	}
	pending := 0
	for _, d := range report.Deletions {
		identity := deleteIdentity(ctx, auth, st, op.Issuer, d.AccountID, subjects[d.AccountID])
		if identity != identityDeleted {
			pending++
		}
		fmt.Fprintf(stdout, "deletion %s: account row %s, tombstone %s, erased again %d profiles, %d device links, %d events, %d imports; identity %s\n",
			d.DeletionID, createdOr(d.AnchorCreated), createdOr(d.RecordCreated), d.Profiles, d.DeviceLinks, d.Events, d.Imports, identity)
	}
	if pending > 0 {
		fmt.Fprintf(stdout, "ayailmu-ledger: replayed %d deletions; %d identity deletions pending\n", len(report.Deletions), pending)
		fmt.Fprintln(stderr, "ayailmu-ledger: the replay committed, but an identity deletion is not confirmed: keep the restore unexposed and replay the same ledger again until it exits 0")
		return exitPending
	}
	fmt.Fprintf(stdout, "ayailmu-ledger: replayed %d deletions; every identity deletion is confirmed\n", len(report.Deletions))
	return exitOK
}

// deleteIdentity makes this run's one attempt to delete an entry's exact identity, the trusted issuer's subject, at Auth
// with the server credential, and records it (store.RecordIdentityAttempt). It returns identityDeleted only when Auth
// confirmed the deletion, its precise user_not_found included, and the record took the attempt; otherwise the identity
// is pending, for the fixed reason it returns. An attempt once begun runs on to its record even if the run is
// interrupted, so an attempt made is an attempt recorded; an interrupted run begins none.
func deleteIdentity(ctx context.Context, auth authn.IdentityDeleter, st *store.Store, issuer, accountID, subject string) string {
	if ctx.Err() != nil {
		return "pending: not attempted, as the run was interrupted"
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), identityStepTimeout)
	defer cancel()
	confirmed := auth.DeleteIdentity(ctx, authn.Identity{Issuer: issuer, Subject: subject}) == nil
	_, err := st.RecordIdentityAttempt(ctx, accountID, confirmed)
	switch {
	case err != nil && confirmed:
		return "pending: Auth confirmed its deletion, but recording the attempt failed"
	case err != nil:
		return "pending: Auth did not confirm its deletion, and recording the attempt failed"
	case !confirmed:
		return "pending: Auth did not confirm its deletion"
	default:
		return identityDeleted
	}
}

// openStore opens the configured database, dialing only AYA_DB_HOSTS as pgx parsed them, and checks with reads only
// that its schema is this binary's. A failure is reported on stderr, and nil returned.
func openStore(ctx context.Context, op config.LedgerOperator, stderr io.Writer) *store.Store {
	st, err := store.OpenAllowing(ctx, op.DatabaseURL.Reveal(), op.Schema, op.DBHosts, store.PrivateNetwork(op.DBPrivateNetwork))
	if err != nil {
		fmt.Fprintln(stderr, "ayailmu-ledger: cannot open the database:", reason(err))
		return nil
	}
	if err := st.VerifySchema(ctx); err != nil {
		st.Close()
		fmt.Fprintln(stderr, "ayailmu-ledger: refusing the database:", reason(err))
		return nil
	}
	return st
}

// readLedgerFile reads a replay's ledger from a private file, as package config reads a secret file: an absolute path
// whose final component is this user's own regular file, not a link, closed to group and others, of at most
// store.MaxLedgerBytes. The file read must be the file checked. Nothing about the file reaches an error.
func readLedgerFile(path string) ([]byte, bool) {
	if !filepath.IsAbs(path) {
		return nil, false
	}
	checked, err := os.Lstat(path)
	if err != nil || !privateLedger(checked) {
		return nil, false
	}
	f, err := os.OpenFile(path, os.O_RDONLY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return nil, false
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil || !os.SameFile(checked, opened) || !privateLedger(opened) {
		return nil, false
	}
	data, err := io.ReadAll(io.LimitReader(f, store.MaxLedgerBytes+1))
	if err != nil || len(data) > store.MaxLedgerBytes {
		return nil, false
	}
	return data, true
}

// privateLedger reports whether info is a regular file of at most store.MaxLedgerBytes that this process's user owns
// and that its group and others can neither read, write nor execute.
func privateLedger(info fs.FileInfo) bool {
	st, ok := info.Sys().(*syscall.Stat_t)
	return ok && info.Mode().IsRegular() && info.Mode().Perm()&0o077 == 0 && int64(st.Uid) == int64(os.Getuid()) &&
		info.Size() <= store.MaxLedgerBytes
}

// writeNewFile writes data into a new file at path that only this user may read or write (0600), and makes it durable.
// O_EXCL refuses an existing file and a link alike, so nothing is ever replaced. A file it created but could not
// complete is removed again. It returns the fixed reason it failed, or "".
func writeNewFile(path string, data []byte) string {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return newLedgerRefusal
	}
	_, err = f.Write(data)
	if err == nil {
		err = f.Chmod(0o600) // exactly 0600, whatever the umask removed
	}
	if err == nil {
		err = f.Sync()
	}
	if closeErr := f.Close(); err == nil {
		err = closeErr
	}
	switch {
	case err == nil:
		return ""
	case os.Remove(path) != nil:
		return "the ledger file could not be completed, nor removed: delete it, as it is no ledger"
	default:
		return "the ledger file could not be completed and was removed: nothing was exported"
	}
}

// createdOr names what a replay did with an account's row or tombstone: created it, or kept the one there was.
func createdOr(created bool) string {
	if created {
		return "created"
	}
	return "kept"
}

// refused reports a refusal, which wrote nothing and asked Auth nothing, and returns its exit status.
func refused(stderr io.Writer, why string) int {
	fmt.Fprintln(stderr, "ayailmu-ledger: refusing to run:", why)
	return exitRefused
}

// reason describes a failure without text that could quote the database URL, its password, a row or an answer of Auth:
// a guard refusal names the setting or gives its fixed reason, and anything else gives only its class.
func reason(err error) string {
	for _, guard := range guardErrors {
		if errors.Is(err, guard) {
			return err.Error()
		}
	}
	return "failed (" + store.ErrorClass(err) + ")"
}
