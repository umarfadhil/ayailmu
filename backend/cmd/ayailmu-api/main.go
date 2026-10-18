// Command ayailmu-api runs the local AyaIlmu backend in emulator mode: a loopback listener, a demo
// Firebase project through the local Auth emulator, and a loopback or Unix-socket PostgreSQL. Every
// guard runs before the socket is bound, and production mode is refused. Settings come from the
// environment; see backend/docs/Backend_Local_Contract.md §12.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"syscall"

	"ayailmu.local/backend/internal/authn"
	"ayailmu.local/backend/internal/config"
	"ayailmu.local/backend/internal/server"
	"ayailmu.local/backend/internal/store"
)

// guardErrors are refusals whose messages name a setting and never quote its value.
var guardErrors = []error{
	config.ErrMissing, config.ErrInvalidMode, config.ErrProductionRefused, config.ErrNotLoopback,
	config.ErrNotDemoProject, config.ErrDatabaseNotLocal, config.ErrInvalidSchema, config.ErrRealCredentials,
	authn.ErrUnsafeConfig, store.ErrDatabaseNotLocal, store.ErrInvalidDatabaseURL, store.ErrInvalidSchema,
}

func main() {
	os.Exit(run())
}

func run() int {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	slog.SetDefault(logger)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	svc, err := server.New(ctx, os.LookupEnv, server.Options{})
	if err != nil {
		logger.Error("ayailmu-api: refusing to start", "reason", reason(err))
		return 1
	}
	defer svc.Close()
	logger.Info("ayailmu-api: serving", "listen", svc.ListenAddr(), "mode", config.ModeEmulator)
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
