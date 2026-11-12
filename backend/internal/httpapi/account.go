package httpapi

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"ayailmu.local/backend/internal/authn"
	"ayailmu.local/backend/internal/envelope"
	"ayailmu.local/backend/internal/store"
)

// The account controls (contract §13): GET /v1/me/export, GET and POST /v1/me/deletion.

const (
	// recentSignInWindow is how old a sign-in may be for an export or a deletion; signInClockSkew is how
	// far ahead of the server clock it may be.
	recentSignInWindow = 5 * time.Minute
	signInClockSkew    = time.Minute
	// confirmDeletion is the exact confirmation a deletion request carries, next to the caller's own
	// account ID.
	confirmDeletion = "delete-account"
	// identityStepTimeout bounds a deletion's identity step and its record. The step runs detached from
	// the request, so a client that disconnects after the erasure committed still leaves the record
	// honest.
	identityStepTimeout = 30 * time.Second
	// exportFormat names the export document's version.
	exportFormat = "ayailmu-server-export-1"
	// exportChunkBytes is the size of the pieces an export is collected in.
	exportChunkBytes = 64 << 10
)

// stepUpChallenge asks for a sign-in no older than max_age seconds (RFC 9470).
var stepUpChallenge = `Bearer realm="ayailmu", error="insufficient_user_authentication", max_age=` +
	strconv.Itoa(int(recentSignInWindow/time.Second))

// Deletion states.
const (
	deletionCompleted       = "completed"
	deletionIdentityPending = "identity_deletion_pending"
)

// namedReason is one stable name with its explanation.
type namedReason struct {
	What string `json:"what"`
	Why  string `json:"why"`
}

// deletionNotDeleted names what a deletion leaves. No retention period or purge for the deletion record
// is decided, and the document says so rather than inventing one.
var deletionNotDeleted = []namedReason{
	{What: "deletion_record", Why: "kept: the account ID, the identity provider's issuer and user ID (subject), the account's creation time, and this deletion's ID, times, attempts and erased counts; how long it is kept is not decided yet"},
	{What: "device_data", Why: "copies on devices stay until each device removes them; the server cannot reach them"},
}

type deletionDoc struct {
	DeletionID       string              `json:"deletion_id"`
	AccountID        string              `json:"account_id"`
	Status           string              `json:"status"`
	RequestedAt      string              `json:"requested_at"`
	CompletedAt      string              `json:"completed_at,omitempty"`
	ServerData       erasedDoc           `json:"server_data"`
	IdentityProvider identityProviderDoc `json:"identity_provider"`
	NotDeleted       []namedReason       `json:"not_deleted"`
}

// erasedDoc is the server data a deletion erased, in the one transaction that recorded it.
type erasedDoc struct {
	Status      string `json:"status"`
	ErasedAt    string `json:"erased_at"`
	Profiles    int    `json:"profiles"`
	DeviceLinks int    `json:"device_links"`
	Events      int64  `json:"events"`
	Imports     int    `json:"imports"`
}

type identityProviderDoc struct {
	Status    string `json:"status"`
	Attempts  int    `json:"attempts"`
	DeletedAt string `json:"deleted_at,omitempty"`
}

// deletionDocOf reports a recorded deletion. It is completed only once an identity attempt was
// confirmed; until then the identity step is pending, and nothing claims it deleted.
func deletionDocOf(d store.Deletion) deletionDoc {
	erasedAt := store.FormatTime(d.RequestedAt)
	doc := deletionDoc{
		DeletionID:  d.DeletionID,
		AccountID:   d.AccountID,
		Status:      deletionIdentityPending,
		RequestedAt: erasedAt,
		ServerData: erasedDoc{Status: "erased", ErasedAt: erasedAt, Profiles: d.Profiles, DeviceLinks: d.DeviceLinks,
			Events: d.Events, Imports: d.Imports},
		IdentityProvider: identityProviderDoc{Status: "pending", Attempts: d.IdentityAttempts},
		NotDeleted:       deletionNotDeleted,
	}
	if d.IdentityDeletedAt != nil {
		at := store.FormatTime(*d.IdentityDeletedAt)
		doc.Status, doc.CompletedAt = deletionCompleted, at
		doc.IdentityProvider.Status, doc.IdentityProvider.DeletedAt = "deleted", at
	}
	return doc
}

// recentSignIn answers 401 reauthentication_required unless the caller's verified sign-in time lies
// within the last five minutes, and at most a minute ahead of the handler's clock (Deps.Now, the real
// clock unless a test sets one), and reports whether it does. The sign-in time is the verifier's: the
// token's auth_time in emulator mode, its password amr time in local-supabase mode. Token refreshes
// keep it, it is never the issue time, and an unknown one is never recent.
func (h *handler) recentSignIn(w http.ResponseWriter, c *call) bool {
	now := h.now()
	if t := c.authTime; !t.IsZero() && !t.Before(now.Add(-recentSignInWindow)) && !t.After(now.Add(signInClockSkew)) {
		return true
	}
	writeReauthenticationRequired(w)
	return false
}

// getDeletion serves GET /v1/me/deletion: the account's deletion, or 404 when there is none. It needs no
// recent sign-in, and a deleted account may read it.
func (h *handler) getDeletion(w http.ResponseWriter, r *http.Request, c *call) {
	d, found, err := h.store.AccountDeletion(r.Context(), c.accountID)
	switch {
	case err != nil:
		h.internal(w, "read account deletion", err)
	case !found:
		writeNotFound(w)
	default:
		writeJSON(w, http.StatusOK, deletionDocOf(d))
	}
}

// postDeletion serves POST /v1/me/deletion: the confirmation (400, 422), then a recent sign-in (401),
// then the deletion. Step 1 erases the server data and records the deletion in one transaction, or
// finds it recorded; nothing is erased twice. Step 2, only after step 1 committed, deletes the identity
// account unless an earlier attempt was confirmed. The answer is 200 once the identity deletion is
// confirmed and 202 while it is pending; 503 when step 1 failed and nothing was deleted.
func (h *handler) postDeletion(w http.ResponseWriter, r *http.Request, c *call) {
	if p := parseDeletionRequest(c.body, c.accountID); p != nil {
		writeProblem(w, p)
		return
	}
	if !h.recentSignIn(w, c) {
		return
	}
	d, err := h.store.EraseAccount(r.Context(), c.accountID, h.beforeCommit)
	switch {
	case errors.Is(err, store.ErrErasureFailed):
		h.log.Error("httpapi: account erasure rolled back; nothing was deleted", "error_class", store.ErrorClass(err))
		writeProblem(w, newProblem(http.StatusServiceUnavailable, codeAccountDeletionFailed, "nothing was deleted; the request can be sent again"))
		return
	case err != nil:
		// The COMMIT outcome is unknown; GET /v1/me/deletion tells.
		h.internal(w, "commit account erasure", err)
		return
	}
	if d.IdentityDeletedAt == nil {
		if d, err = h.deleteIdentity(r.Context(), c, d); err != nil {
			h.internal(w, "record identity deletion", err)
			return
		}
	}
	status := http.StatusOK
	if d.IdentityDeletedAt == nil {
		status = http.StatusAccepted
	}
	writeJSON(w, status, deletionDocOf(d))
}

// parseDeletionRequest checks a deletion request: exactly {"confirm":"delete-account","account_id":
// "<the caller's account ID>"}. The wrong shape is 400; any other confirmation or account ID gets one
// fixed 422, so the answer never tells another account's ID from any other wrong value.
func parseDeletionRequest(body []byte, accountID string) *problem {
	if p := strictJSON(body); p != nil {
		return p
	}
	members, ok := objectMembers(body)
	confirm, okConfirm := jsonString(members["confirm"])
	account, okAccount := jsonString(members["account_id"])
	if !ok || len(members) != 2 || !okConfirm || !okAccount {
		return invalidRequest(`the body must be {"confirm":"delete-account","account_id":"<your account ID>"} with no other member`)
	}
	if confirm != confirmDeletion || account != accountID {
		return newProblem(http.StatusUnprocessableEntity, codeDeletionNotConfirmed,
			`a deletion is confirmed only by "confirm":"delete-account" with the account_id of the signed-in account`)
	}
	return nil
}

// deleteIdentity is step 2 of a deletion: the BeforeIdentityDeletion seam, then the identity provider,
// then the attempt's record, which it returns. It runs detached from the request's cancellation. The
// log gets the deletion ID and the failure's class, never the provider's message or the subject.
func (h *handler) deleteIdentity(ctx context.Context, c *call, d store.Deletion) (store.Deletion, error) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), identityStepTimeout)
	defer cancel()
	err := h.attemptIdentityDeletion(ctx, c.identity)
	if err != nil {
		h.log.Warn("httpapi: identity deletion pending", "deletion_id", d.DeletionID, "error_class", identityErrorClass(err))
	}
	return h.store.RecordIdentityAttempt(ctx, c.accountID, err == nil)
}

func (h *handler) attemptIdentityDeletion(ctx context.Context, id authn.Identity) error {
	if h.beforeIdentityDeletion != nil {
		if err := h.beforeIdentityDeletion(ctx); err != nil {
			return err
		}
	}
	return h.deleter.DeleteIdentity(ctx, id)
}

// identityErrorClass names a failed identity deletion without its text.
func identityErrorClass(err error) string {
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		return "timeout"
	case errors.Is(err, context.Canceled):
		return "canceled"
	case errors.Is(err, authn.ErrIdentityNotDeleted):
		return "identity_provider"
	default:
		return "other"
	}
}

// errExportTooLarge stops an export whose next bytes would pass the limit.
var errExportTooLarge = errors.New("httpapi: the export would pass its limit")

// exportContents is what the export says about itself: what it holds and what it does not.
var exportContents = exportContentsDoc{
	Included: "every record this service stores for the account: the account record, and each profile with its settings, consent, linked devices, imports and answer records, each payload exactly as stored",
	NotIncluded: []namedReason{
		{What: "identity_provider_account", Why: "sign-in address, password and sign-in methods are held by the identity provider"},
		{What: "device_data", Why: "guest data, answers not yet uploaded and session state stay on devices; the app adds this device's own data"},
		{What: "credentials", Why: "this service stores no password, token or key"},
	},
}

type exportContentsDoc struct {
	Included    string        `json:"included"`
	NotIncluded []namedReason `json:"not_included"`
}

// exportHead is the export document up to its profiles.
type exportHead struct {
	Format      string            `json:"format"`
	GeneratedAt string            `json:"generated_at"`
	Contents    exportContentsDoc `json:"contents"`
	Account     exportAccountDoc  `json:"account"`
}

type exportAccountDoc struct {
	AccountID string `json:"account_id"`
	CreatedAt string `json:"created_at"`
	Issuer    string `json:"issuer"`
	Subject   string `json:"subject"`
	AuthMode  string `json:"auth_mode"`
}

// exportProfileDoc is a profile up to its lists.
type exportProfileDoc struct {
	ProfileID string            `json:"profile_id"`
	Kind      string            `json:"kind"`
	CreatedAt string            `json:"created_at"`
	Revision  int64             `json:"revision"`
	HighSeq   int64             `json:"high_seq"`
	Settings  exportSettingsDoc `json:"settings"`
	Consent   consentDoc        `json:"consent"`
}

// exportSettingsDoc names every setting column, null when unset.
type exportSettingsDoc struct {
	InstructionLang *string  `json:"instruction_lang"`
	SessionMinutes  *int     `json:"session_minutes"`
	ArabicScale     *float64 `json:"arabic_scale"`
}

type exportSourceDoc struct {
	App            string `json:"app"`
	InstallID      string `json:"install_id"`
	LocalProfileID string `json:"local_profile_id"`
	LinkedAt       string `json:"linked_at"`
}

type exportImportDoc struct {
	ImportID      string          `json:"import_id"`
	CreatedAt     string          `json:"created_at"`
	RequestSHA256 string          `json:"request_sha256"`
	Receipt       json.RawMessage `json:"receipt"`
}

// exportEventDoc is a stored event without its payload, which writeExport appends verbatim.
type exportEventDoc struct {
	Seq              int64               `json:"seq"`
	EventID          string              `json:"event_id"`
	Kind             string              `json:"kind"`
	Schema           string              `json:"schema"`
	SchemaVersion    int                 `json:"schema_version"`
	Curriculum       envelope.Curriculum `json:"curriculum"`
	CurriculumStatus string              `json:"curriculum_status"`
	Source           envelope.Source     `json:"source"`
	SemanticSHA256   string              `json:"semantic_sha256"`
	ClockFlags       []string            `json:"clock_flags"`
	OccurredAt       string              `json:"occurred_at"`
	LocalDate        string              `json:"local_date"`
	ReceivedAt       string              `json:"received_at"`
	ImportID         *string             `json:"import_id"`
}

// exportAccount serves GET /v1/me/export: after a recent sign-in, every record this service stores for
// the account, built whole from one snapshot within the export limit and only then sent. An export that
// would pass the limit is 413 export_too_large, and no part of it is sent.
func (h *handler) exportAccount(w http.ResponseWriter, r *http.Request, c *call) {
	if !h.recentSignIn(w, c) {
		return
	}
	body := &exportBody{max: h.exportMax}
	err := h.store.ExportAccount(r.Context(), c.accountID, func(x *store.Export) error {
		return writeExport(r.Context(), body, x)
	})
	switch {
	case errors.Is(err, errExportTooLarge):
		writeProblem(w, newProblem(http.StatusRequestEntityTooLarge, codeExportTooLarge,
			fmt.Sprintf("the account's server export is larger than the %d-byte limit; nothing was exported", h.exportMax)))
	case errors.Is(err, store.ErrAccountDeleted):
		writeAccountDeleted(w)
	case err != nil:
		h.internal(w, "export account", err)
	default:
		body.writeTo(w)
	}
}

// writeExport encodes the export into b by hand, like writePage, so every payload keeps its exact stored
// bytes. It returns errExportTooLarge as soon as the next bytes would pass the limit, which stops the
// reading.
func writeExport(ctx context.Context, b *exportBody, x *store.Export) error {
	head, err := compactJSON(exportHead{
		Format: exportFormat,
		// Whole seconds in UTC: a fixed width, so the same data always encodes to the same length.
		GeneratedAt: x.At.UTC().Format(time.RFC3339),
		Contents:    exportContents,
		Account: exportAccountDoc{AccountID: x.Account.AccountID, CreatedAt: store.FormatTime(x.Account.CreatedAt),
			Issuer: x.Account.Issuer, Subject: x.Account.Subject, AuthMode: x.Account.AuthMode},
	})
	if err != nil {
		return err
	}
	b.write(head[:len(head)-1]) // everything but the closing brace
	b.writeString(`,"profiles":[`)
	n := 0
	if err := x.Profiles(ctx, func(p store.ExportedProfile) error {
		if n > 0 {
			b.writeString(",")
		}
		n++
		return writeExportProfile(ctx, b, x, p)
	}); err != nil {
		return err
	}
	b.writeString("]}")
	return b.err
}

// writeExportProfile encodes one profile with its device links, imports and events.
func writeExportProfile(ctx context.Context, b *exportBody, x *store.Export, p store.ExportedProfile) error {
	meta, err := compactJSON(exportProfileDoc{
		ProfileID: p.ProfileID,
		Kind:      p.Kind,
		CreatedAt: store.FormatTime(p.CreatedAt),
		Revision:  p.Revision,
		HighSeq:   p.HighSeq,
		Settings: exportSettingsDoc{InstructionLang: p.Settings.InstructionLang, SessionMinutes: p.Settings.SessionMinutes,
			ArabicScale: p.Settings.ArabicScale},
		Consent: consentDoc{Version: p.ConsentVersion, At: store.FormatTime(p.ConsentAt)},
	})
	if err != nil {
		return err
	}
	b.write(meta[:len(meta)-1]) // everything but the closing brace
	b.writeString(`,"sources":[`)
	n := 0
	if err := x.Sources(ctx, p.ProfileID, func(s store.ExportedSource) error {
		return b.element(&n, exportSourceDoc{App: s.App, InstallID: s.InstallID, LocalProfileID: s.LocalProfileID,
			LinkedAt: store.FormatTime(s.LinkedAt)})
	}); err != nil {
		return err
	}
	b.writeString(`],"imports":[`)
	n = 0
	if err := x.Imports(ctx, p.ProfileID, func(i store.ExportedImport) error {
		return b.element(&n, exportImportDoc{ImportID: i.ImportID, CreatedAt: store.FormatTime(i.CreatedAt),
			RequestSHA256: hex.EncodeToString(i.RequestSHA256[:]), Receipt: i.Receipt})
	}); err != nil {
		return err
	}
	b.writeString(`],"events":[`)
	n = 0
	if err := x.Events(ctx, p.ProfileID, func(e store.ExportedEvent) error {
		meta, err := compactJSON(exportEventDoc{
			Seq:              e.Seq,
			EventID:          e.EventID,
			Kind:             e.Kind,
			Schema:           e.Schema,
			SchemaVersion:    e.SchemaVersion,
			Curriculum:       e.Curriculum,
			CurriculumStatus: e.CurriculumStatus,
			Source:           e.Source,
			SemanticSHA256:   hex.EncodeToString(e.SemanticSHA256[:]),
			ClockFlags:       e.ClockFlags,
			OccurredAt:       store.FormatTime(e.OccurredAt),
			LocalDate:        e.LocalDate.Format(time.DateOnly),
			ReceivedAt:       store.FormatTime(e.ReceivedAt),
			ImportID:         e.ImportID,
		})
		if err != nil {
			return err
		}
		if n > 0 {
			b.writeString(",")
		}
		n++
		b.write(meta[:len(meta)-1]) // everything but the closing brace
		b.writeString(`,"payload":`)
		b.write(e.Payload)
		b.writeString("}")
		return b.err
	}); err != nil {
		return err
	}
	b.writeString("]}")
	return b.err
}

// compactJSON encodes v as encode does, without the trailing newline: a part of a document written by
// hand.
func compactJSON(v any) ([]byte, error) {
	b, err := encode(v)
	if err != nil {
		return nil, err
	}
	return bytes.TrimSuffix(b, []byte("\n")), nil
}

// exportBody collects an export of at most max bytes in fixed-size chunks, so it never copies itself as
// it grows and holds no more than the limit plus one chunk. The first write that would pass max writes
// nothing, drops what was collected and leaves errExportTooLarge in err, which fails every later write.
type exportBody struct {
	chunks [][]byte
	size   int
	max    int
	err    error
}

func (b *exportBody) write(p []byte) {
	if b.err != nil {
		return
	}
	if len(p) > b.max-b.size {
		b.chunks, b.err = nil, errExportTooLarge
		return
	}
	b.size += len(p)
	for len(p) > 0 {
		if n := len(b.chunks); n == 0 || len(b.chunks[n-1]) == cap(b.chunks[n-1]) {
			b.chunks = append(b.chunks, make([]byte, 0, exportChunkBytes))
		}
		last := &b.chunks[len(b.chunks)-1]
		k := min(len(p), cap(*last)-len(*last))
		*last = append(*last, p[:k]...)
		p = p[k:]
	}
}

func (b *exportBody) writeString(s string) {
	b.write([]byte(s))
}

// element writes v as the next element of an open list, after a comma unless it is the first, and
// counts it in n.
func (b *exportBody) element(n *int, v any) error {
	enc, err := compactJSON(v)
	if err != nil {
		return err
	}
	if *n > 0 {
		b.writeString(",")
	}
	*n++
	b.write(enc)
	return b.err
}

// writeTo sends the whole export with its length.
func (b *exportBody) writeTo(w http.ResponseWriter) {
	hdr := w.Header()
	hdr.Set("Content-Type", "application/json")
	hdr.Set("Content-Length", strconv.Itoa(b.size))
	w.WriteHeader(http.StatusOK)
	for _, chunk := range b.chunks {
		if _, err := w.Write(chunk); err != nil {
			return
		}
	}
}
