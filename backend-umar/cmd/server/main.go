package main

import (
	"context"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/umarfadhil/ayailmu/backend-umar/internal/accounterase"
	"github.com/umarfadhil/ayailmu/backend-umar/internal/api"
	"github.com/umarfadhil/ayailmu/backend-umar/internal/auth"
	"github.com/umarfadhil/ayailmu/backend-umar/internal/catalog"
	"github.com/umarfadhil/ayailmu/backend-umar/internal/labconfig"
	"github.com/umarfadhil/ayailmu/backend-umar/internal/store"
)

func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
func main() {
	if err := run(); err != nil {
		log.Print(err)
		os.Exit(1)
	}
}
func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	addr := env("UMAR_LISTEN", "127.0.0.1:8185")
	host, _, err := net.SplitHostPort(addr)
	ip := net.ParseIP(host)
	if err != nil || ip == nil || !ip.IsLoopback() {
		return errors.New("prototype must bind a loopback address")
	}
	// Production runs only GoTrue in NORMAL_ONLY mode. The old Keycloak and SYNTHETIC_LAB setups
	// were local QA harnesses and are refused here.
	provider := env("UMAR_AUTH_PROVIDER", "gotrue")
	if provider != "gotrue" {
		return errors.New("UMAR_AUTH_PROVIDER must be gotrue")
	}
	migrate, err := labconfig.MigrateOnStart(os.Getenv("UMAR_MIGRATE_ON_START"))
	if err != nil {
		return err
	}
	issuer, jwks, audience := "http://127.0.0.1:8287", "http://127.0.0.1:8287/.well-known/jwks.json", "authenticated"
	issuer, err = labconfig.Issuer(provider, os.Getenv("UMAR_PUBLIC_ORIGIN"), os.Getenv("UMAR_OIDC_ISSUER"), issuer)
	if err != nil {
		return err
	}
	v, err := auth.New(ctx, auth.Config{Provider: provider, Issuer: issuer, JWKSURL: env("UMAR_OIDC_JWKS_URL", jwks), Audience: audience, ClientID: "umar-native", AllowLoopbackHTTP: true})
	if err != nil {
		return err
	}
	dataMode := api.DeploymentDataMode(env("UMAR_DATA_MODE", string(api.DeploymentNormalOnly)))
	if dataMode != api.DeploymentNormalOnly {
		return errors.New("UMAR_DATA_MODE must be NORMAL_ONLY")
	}
	release, err := api.ParseReleasePolicy(os.Getenv("UMAR_NORMAL_RELEASE_READY"), os.Getenv("UMAR_NORMAL_DECLARATION_VERSION"), os.Getenv("UMAR_NORMAL_SYNC_POLICY_VERSION"))
	if err != nil {
		return err
	}
	erasureProvider, err := accountErasureProvider(os.Getenv, dataMode, provider, issuer)
	if err != nil {
		return err
	}
	r, err := startupRegistry(release.Enabled)
	if err != nil {
		return errors.New("catalog initialization failed")
	}
	s, err := store.Open(ctx, os.Getenv("UMAR_DATABASE_URL"), r)
	if err != nil {
		return err
	}
	defer s.Close()
	startup, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if err = s.Prepare(startup, migrate); err != nil {
		return errors.New("database preparation failed; verify schema and role configuration")
	}
	var erasure *accounterase.Coordinator
	if erasureProvider != nil {
		erasure, err = accounterase.New(s, erasureProvider)
		if err != nil {
			return errors.New("account erasure initialization failed")
		}
	}
	workerDone := make(chan error, 1)
	workerContext, stopWorker := context.WithCancel(ctx)
	var worker sync.WaitGroup
	if erasure != nil {
		worker.Add(1)
		go func() { defer worker.Done(); workerDone <- erasure.Run(workerContext) }()
	}
	// Stop/join the worker before the deferred database close, including HTTP startup errors.
	defer func() { stopWorker(); worker.Wait() }()
	server := &http.Server{Addr: addr, Handler: api.NewWithAccountErasure(s, v, r, release, erasure, dataMode), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 32768}
	done := make(chan error, 1)
	go func() {
		log.Printf("Umar API listening at http://%s (normal release enabled=%t, data mode=%s)", addr, release.Enabled, dataMode)
		done <- server.ListenAndServe()
	}()
	select {
	case err = <-done:
		if !errors.Is(err, http.ErrServerClosed) {
			return errors.New("HTTP server failed")
		}
	case <-workerDone:
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
		if ctx.Err() != nil {
			return nil
		}
		return errors.New("account erasure worker stopped unexpectedly")
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return server.Shutdown(shutdown)
	}
	return nil
}

// An enabled normal release must select its exact reviewed artifact. Legacy
// unready/lab startup keeps its embedded default only when no selection is set.
func startupRegistry(normal bool) (*catalog.Registry, error) {
	path := os.Getenv("UMAR_REVIEWED_REGISTRY_PATH")
	if normal && path == "" {
		return nil, errors.New("normal release requires an explicit reviewed registry")
	}
	return catalog.LoadDeployment(path, os.Getenv("UMAR_REVIEWED_REGISTRY_SHA256"), os.Getenv("UMAR_REVIEWED_REGISTRY_SOURCE_COMMIT"), normal)
}
