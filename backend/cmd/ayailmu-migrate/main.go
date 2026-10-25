// Command ayailmu-migrate is the migration job of the deploy modes: it applies the embedded migrations as the schema's
// owner, prints only the resulting schema version, and exits. The API itself only verifies the schema in those modes, so
// its runtime role needs no DDL right. Settings come from the environment: the owner's database URL from its private file
// (AYA_DATABASE_URL_FILE), the exact database hosts (AYA_DB_HOSTS) and the schema (AYA_DB_SCHEMA). Every database host
// other than a literal loopback IP or a Unix socket must be reached over verified TLS (sslmode=verify-full); only an
// explicit AYA_DB_TRANSPORT=private-network allows sslmode=disable, and only to a private target (internal/store/transport.go).
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"
	"time"

	"ayailmu.local/backend/internal/config"
	"ayailmu.local/backend/internal/store"
)

// migrateTimeout bounds the whole job: connecting, migrating and verifying the result.
const migrateTimeout = 5 * time.Minute

// guardErrors are refusals whose messages name a setting or give a fixed reason, and never quote a value, a path or a
// password.
var guardErrors = []error{
	config.ErrMissing, config.ErrInvalidSchema, config.ErrRealCredentials, config.ErrUnsafeSecretFile,
	config.ErrInvalidHostList, config.ErrDatabaseHostNotAllowed, config.ErrEmulatorEnvironment, config.ErrSecretInEnvironment,
	config.ErrInvalidDBTransport, store.ErrInvalidDatabaseURL, store.ErrInvalidSchema, store.ErrDatabaseHostNotAllowed,
	store.ErrDatabaseTransportInsecure, store.ErrDatabasePlaintextNotPrivate, store.ErrSchemaNotCurrent,
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	code := run(ctx, os.LookupEnv, os.Stdout, os.Stderr)
	stop()
	os.Exit(code)
}

// run applies the migrations configured through lookup and returns the exit status: 0 with the resulting version on
// stdout, or 1 with a reason on stderr that names a setting and quotes no value. A refused configuration opens nothing.
// Once the migrations are applied, running it again changes nothing. A schema that records a migration this binary does
// not have stays as it is and fails the job.
func run(ctx context.Context, lookup func(string) (string, bool), stdout, stderr io.Writer) int {
	m, err := config.LoadMigration(lookup)
	if err != nil {
		fmt.Fprintln(stderr, "ayailmu-migrate: refusing to run:", reason(err))
		return 1
	}
	ctx, cancel := context.WithTimeout(ctx, migrateTimeout)
	defer cancel()
	st, err := store.OpenAllowing(ctx, m.DatabaseURL.Reveal(), m.Schema, m.DBHosts, store.PrivateNetwork(m.DBPrivateNetwork))
	if err != nil {
		fmt.Fprintln(stderr, "ayailmu-migrate: cannot open the database:", reason(err))
		return 1
	}
	defer st.Close()
	if err := st.Migrate(ctx); err != nil {
		fmt.Fprintln(stderr, "ayailmu-migrate: the migration failed:", reason(err))
		return 1
	}
	if err := st.VerifySchema(ctx); err != nil {
		fmt.Fprintln(stderr, "ayailmu-migrate: the schema is not this binary's after migrating:", reason(err))
		return 1
	}
	version, err := store.SchemaVersion()
	if err != nil {
		fmt.Fprintln(stderr, "ayailmu-migrate: the embedded migrations are unreadable")
		return 1
	}
	fmt.Fprintln(stdout, version)
	return 0
}

// reason describes a failure without text that could quote the database URL or its password: a guard refusal names the
// setting, and anything else gives only its class.
func reason(err error) string {
	for _, guard := range guardErrors {
		if errors.Is(err, guard) {
			return err.Error()
		}
	}
	return "failed (" + store.ErrorClass(err) + ")"
}
