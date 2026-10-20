// Command ayailmu-api runs the local AyaIlmu backend: a loopback listener and a loopback or Unix-socket
// PostgreSQL, in the local synthetic Supabase mode (one configured loopback Supabase Auth, whose key set
// it fetches before it serves) or, only when built with the firebase_emulator tag, in the legacy emulator
// mode (a demo Firebase project through the local Auth emulator). A default build refuses emulator mode
// (authn.ErrEmulatorDisabled). In a container it also runs the deploy modes, deploy-smoke (deny-all) and
// local-compose (the synthetic Compose stack's own Auth), which only verify their schema: the migration
// job (cmd/ayailmu-migrate) migrates it. Every guard runs before the socket is bound, and production
// mode is refused. Settings come from the environment; see backend/docs/Backend_Local_Contract.md §12.
// Before anything is refused or served, it logs once which build it is, as the Go toolchain stamped it
// (internal/provenance): a revision and dirty state, or unknown. Nothing of it is served.
//
// `ayailmu-api probe <url>` is the container healthcheck instead: one bounded GET of a literal-loopback
// http URL (probe.go).
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"runtime/debug"
	"syscall"

	"ayailmu.local/backend/internal/authn"
	"ayailmu.local/backend/internal/config"
	"ayailmu.local/backend/internal/provenance"
	"ayailmu.local/backend/internal/server"
	"ayailmu.local/backend/internal/store"
)

// guardErrors are refusals whose messages name a setting or give a fixed reason, and never quote a
// value, a path, a credential or an answer of Auth.
var guardErrors = []error{
	config.ErrMissing, config.ErrInvalidMode, config.ErrProductionRefused, config.ErrNotLoopback,
	config.ErrNotDemoProject, config.ErrDatabaseNotLocal, config.ErrInvalidSchema, config.ErrRealCredentials,
	config.ErrInvalidExportLimit, config.ErrNotLocalAuth, config.ErrInvalidAuthSetting, config.ErrUnsafeSecretFile,
	config.ErrInvalidHostList, config.ErrInvalidOrigins, config.ErrDatabaseHostNotAllowed, config.ErrAuthHostNotAllowed,
	config.ErrEmulatorEnvironment, config.ErrSecretInEnvironment, config.ErrNotDeployListen, config.ErrSettingNotUsed,
	config.ErrNotPublicAuth, authn.ErrUnsafeConfig, authn.ErrKeySetUnavailable, authn.ErrEmulatorDisabled,
	store.ErrDatabaseNotLocal, store.ErrInvalidDatabaseURL, store.ErrInvalidSchema, store.ErrDatabaseHostNotAllowed,
	store.ErrSchemaNotCurrent,
}

func main() {
	if len(os.Args) > 1 {
		if os.Args[1] == "probe" {
			os.Exit(probe(os.Args[2:], os.Stderr))
		}
		fmt.Fprintln(os.Stderr, "usage: ayailmu-api, or ayailmu-api probe <url>")
		os.Exit(probeRefused)
	}
	os.Exit(run())
}

func run() int {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	slog.SetDefault(logger)
	stamp := provenance.FromBuildInfo(debug.ReadBuildInfo())
	logger.Info("ayailmu-api: build", "revision", stamp.Revision, "dirty", stamp.Dirty)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	svc, err := server.New(ctx, os.LookupEnv, server.Options{})
	if err != nil {
		logger.Error("ayailmu-api: refusing to start", "reason", reason(err))
		return 1
	}
	defer svc.Close()
	logger.Info("ayailmu-api: serving", "listen", svc.ListenAddr(), "mode", svc.Mode())
	if err := svc.ListenAndServe(ctx); err != nil {
		logger.Error("ayailmu-api: stopped", "reason", reason(err))
		return 1
	}
	logger.Info("ayailmu-api: stopped")
	return 0
}

// reason describes a failure without text that could quote the database URL or a token: a guard
// refusal names the setting, a listen failure gives the system error, and anything else only its class.
func reason(err error) string {
	for _, guard := range guardErrors {
		if errors.Is(err, guard) {
			return err.Error()
		}
	}
	var opErr *net.OpError
	if errors.As(err, &opErr) && opErr.Op == "listen" && opErr.Err != nil {
		return "cannot listen on the configured address: " + opErr.Err.Error()
	}
	return "failed (" + store.ErrorClass(err) + ")"
}
