// Package server assembles the local backend: configuration guards, the configured mode's verifier (the
// Supabase verifier with its Auth's key set fetched at startup, deploy-smoke's deny-all verifier or,
// only in a build with the firebase_emulator tag, the legacy emulator verifier), the guarded store,
// migrated in the loopback modes and only verified in the deploy modes and production, and the HTTP
// handler. A default build refuses emulator mode with authn.ErrEmulatorDisabled before it opens the
// store. Every guard runs before any socket is bound; package config refuses production mode without
// its exact staging opt-in.
package server

import (
	"context"
	"errors"
	"net"
	"net/http"
	"time"

	"ayailmu.local/backend/internal/authn"
	"ayailmu.local/backend/internal/config"
	"ayailmu.local/backend/internal/curriculum"
	"ayailmu.local/backend/internal/httpapi"
	"ayailmu.local/backend/internal/store"
)

// Options are test seams. The zero value is the production configuration.
type Options struct {
	// BeforeCommit, when set, runs inside each event-ingest, import and account-erasure transaction
	// after its rows are written and before COMMIT, while its row locks are still held. Concurrency
	// tests use it as a deterministic barrier; it cannot change what is written or bypass any check.
	BeforeCommit func(ctx context.Context)
	// BeforeIdentityDeletion, when set, runs before each attempt to delete the caller's identity-provider
	// account during an account deletion, after the server data was erased. A non-nil error stands in for
	// a provider failure: the provider is not called and the attempt counts as failed. Tests use it to
	// inject outages; nil in production.
	BeforeIdentityDeletion func(ctx context.Context) error
	// Now, when set, is the service's clock for the recent sign-in the account controls need and, in
	// ModeLocalSupabase, for verifying tokens and aging the fetched key set; the emulator verifier keeps
	// its SDK's own clock. Tests use it to stand at a chosen instant; no time window, token or OS clock
	// changes. Nil means time.Now.
	Now func() time.Time
	// AuthHTTPClient, when set, is the HTTP client the Supabase verifier of a production (staging) service sends every
	// request to Auth with, in place of its own dedicated client: tests give one that trusts a test certificate authority
	// and reaches a stand-in for the staging network. It must verify TLS certificates (authn refuses one that skips
	// verification). Nil in production; the other modes never read it.
	AuthHTTPClient *http.Client
}

// Service is an assembled backend that has not bound a socket yet.
type Service struct {
	cfg     config.Config
	store   *store.Store
	handler http.Handler
}

// New loads the configuration through lookup and applies, in order, the configuration guards, the
// verifier guards and the store guards, then migrates the schema in a loopback mode, or only verifies it
// in a deploy mode or production (store.ErrSchemaNotCurrent unless it is exactly this binary's: the
// migration job changes it, never the service). In ModeLocalSupabase, ModeLocalCompose and
// ModeProduction the verifier guards include fetching Auth's key set: without a usable one the service
// refuses to start. Nothing is opened before the configuration and verifier guards pass, and no socket
// is bound.
func New(ctx context.Context, lookup func(string) (string, bool), opts Options) (*Service, error) {
	cfg, err := config.Load(lookup)
	if err != nil {
		return nil, err
	}
	verifier, err := newVerifier(ctx, cfg, opts)
	if err != nil {
		return nil, err
	}
	st, err := openStore(ctx, cfg)
	if err != nil {
		return nil, err
	}
	// Every verifier also reports sign-in times and deletes its provider's accounts, so it serves the
	// account controls; deploy-smoke's verifies nothing, so they answer its uniform 401. Production's
	// trusted proxies replace the bare Host check with the handler's admission gate.
	h := httpapi.New(httpapi.Deps{
		Mode:                   cfg.Mode,
		AccountMode:            accountMode(cfg.Mode),
		AllowedHosts:           cfg.AllowedHosts,
		TrustedProxies:         cfg.TrustedProxies,
		Deploy:                 config.IsDeployMode(cfg.Mode),
		CORSOrigins:            cfg.CORSOrigins,
		Verifier:               verifier,
		IdentityDeleter:        verifier,
		Store:                  st,
		Registry:               curriculum.Default(),
		ExportMaxBytes:         cfg.ExportMaxBytes,
		BeforeCommit:           opts.BeforeCommit,
		BeforeIdentityDeletion: opts.BeforeIdentityDeletion,
		Now:                    opts.Now,
	})
	return &Service{cfg: cfg, store: st, handler: h}, nil
}

// accountVerifier is what the handler needs of a verifier to serve every route, the account controls
// included: verified sessions with their sign-in time, and deletion of the verified identity's account.
type accountVerifier interface {
	authn.SessionVerifier
	authn.IdentityDeleter
}

// newVerifier builds the configured mode's verifier. In ModeLocalSupabase that is the Supabase verifier
// for the configured loopback Auth (plain http accepted there, as a synthetic local fixture), and in
// ModeLocalCompose the same verifier for the stack's own Auth at its allowlisted internal name (plain
// http accepted only for exactly that host and port). In ModeProduction it is the same verifier, not in
// synthetic mode, for the staging deployment's own standalone GoTrue by its public name over https only,
// whose certificate must verify; it sends every request to Auth with opts.AuthHTTPClient when set, which
// must verify certificates too (authn.ErrUnsafeConfig). Each fetches Auth's key set from that Auth only
// and must establish it now: a service never starts without a usable trusted key set
// (authn.ErrKeySetUnavailable). opts.Now is its clock (nil means time.Now). In ModeDeploySmoke it is the
// deny-all verifier, which contacts nothing. In ModeEmulator it is newEmulatorVerifier's: the legacy
// emulator verifier in a build with the firebase_emulator tag, and authn.ErrEmulatorDisabled in a
// default build, which never falls back to another verifier.
func newVerifier(ctx context.Context, cfg config.Config, opts Options) (accountVerifier, error) {
	switch cfg.Mode {
	case config.ModeEmulator:
		return newEmulatorVerifier(ctx, cfg)
	case config.ModeLocalSupabase, config.ModeLocalCompose:
		return supabaseVerifier(ctx, authn.SupabaseConfig{BaseURL: cfg.Supabase.URL, Issuer: cfg.Supabase.Issuer,
			Audience: cfg.Supabase.Audience, FetchJWKS: true, AdminKey: cfg.Supabase.AdminKey, LocalSynthetic: true,
			InternalHosts: cfg.Supabase.AuthHosts, Now: opts.Now})
	case config.ModeProduction:
		return supabaseVerifier(ctx, authn.SupabaseConfig{BaseURL: cfg.Supabase.URL, Issuer: cfg.Supabase.Issuer,
			Audience: cfg.Supabase.Audience, FetchJWKS: true, AdminKey: cfg.Supabase.AdminKey,
			HTTPClient: opts.AuthHTTPClient, Now: opts.Now})
	case config.ModeDeploySmoke:
		return denyAll{}, nil
	default:
		return nil, config.ErrInvalidMode
	}
}

// supabaseVerifier builds the Supabase verifier c configures and establishes Auth's key set now.
func supabaseVerifier(ctx context.Context, c authn.SupabaseConfig) (accountVerifier, error) {
	v, err := authn.NewSupabaseVerifier(c)
	if err != nil {
		return nil, err
	}
	if err := v.RefreshKeys(ctx); err != nil {
		return nil, err
	}
	return v, nil
}

// openStore opens the configured database. A loopback mode opens it on loopback or a Unix socket and
// migrates the schema. A deploy mode or production opens only AYA_DB_HOSTS, as pgx parsed them, and
// verifies the schema with reads only, so its runtime role needs no DDL right.
func openStore(ctx context.Context, cfg config.Config) (*store.Store, error) {
	if !config.IsDeployMode(cfg.Mode) {
		st, err := store.Open(ctx, cfg.DatabaseURL.Reveal(), cfg.Schema)
		if err != nil {
			return nil, err
		}
		if err := st.Migrate(ctx); err != nil {
			st.Close()
			return nil, err
		}
		return st, nil
	}
	st, err := store.OpenAllowing(ctx, cfg.DatabaseURL.Reveal(), cfg.Schema, cfg.DBHosts)
	if err != nil {
		return nil, err
	}
	if err := st.VerifySchema(ctx); err != nil {
		st.Close()
		return nil, err
	}
	return st, nil
}

// accountMode is the auth_mode an account created in mode records: the kind of provider that verified it.
// local-compose's Auth is a local synthetic Supabase Auth and production's the deployment's own
// standalone one, so their accounts are local-supabase accounts, told apart by their issuer, and the
// account schema needs no new mode. Every other mode records itself.
func accountMode(mode string) string {
	if mode == config.ModeLocalCompose || mode == config.ModeProduction {
		return config.ModeLocalSupabase
	}
	return mode
}

// Mode returns the configured mode, as the startup log and health report it.
func (s *Service) Mode() string {
	return s.cfg.Mode
}

// Handler returns the v1 HTTP handler.
func (s *Service) Handler() http.Handler {
	return s.handler
}

// ListenAddr returns the configured address that ListenAndServe binds: loopback, or in a deploy mode
// 0.0.0.0 or IPv4 loopback inside its container.
func (s *Service) ListenAddr() string {
	return s.cfg.Listen
}

// ListenAndServe binds the configured address and serves until ctx is done, then shuts down.
func (s *Service) ListenAndServe(ctx context.Context) error {
	ln, err := net.Listen("tcp", s.cfg.Listen)
	if err != nil {
		return err
	}
	srv := &http.Server{
		Handler:           s.handler,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       60 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    64 << 10,
	}
	// "OPTIONS *" goes to the handler too, so it gets the Host check and the same headers.
	srv.DisableGeneralOptionsHandler = true
	served := make(chan error, 1)
	go func() { served <- srv.Serve(ln) }()
	select {
	case err := <-served:
		return err
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		err := srv.Shutdown(shutdown)
		if serveErr := <-served; serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) && err == nil {
			err = serveErr
		}
		return err
	}
}

// Close releases the store.
func (s *Service) Close() {
	s.store.Close()
}
