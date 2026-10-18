// Package server assembles the local backend: configuration guards, the emulator verifier, the guarded
// and migrated store, and the HTTP handler. Every guard runs before any socket is bound; production
// mode is refused by package config.
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
	// BeforeCommit, when set, runs inside each event-ingest and import transaction after its rows are
	// written and before COMMIT, while the profile row is still locked. Concurrency tests use it as a
	// deterministic barrier; it cannot change what is written or bypass any check.
	BeforeCommit func(ctx context.Context)
}

// Service is an assembled backend that has not bound a socket yet.
type Service struct {
	cfg     config.Config
	store   *store.Store
	handler http.Handler
}

// New loads the configuration through lookup and applies, in order, the configuration guards, the
// verifier guards and the store guards, then migrates the schema. Nothing is opened before the
// configuration and verifier guards pass, and no socket is bound.
func New(ctx context.Context, lookup func(string) (string, bool), opts Options) (*Service, error) {
	cfg, err := config.Load(lookup)
	if err != nil {
		return nil, err
	}
	verifier, err := authn.NewEmulatorVerifier(ctx, authn.EmulatorConfig{ProjectID: cfg.ProjectID, EmulatorHost: cfg.EmulatorHost})
	if err != nil {
		return nil, err
	}
	st, err := store.Open(ctx, cfg.DatabaseURL.Reveal(), cfg.Schema)
	if err != nil {
		return nil, err
	}
	if err := st.Migrate(ctx); err != nil {
		st.Close()
		return nil, err
	}
	h := httpapi.New(httpapi.Deps{
		Mode:         cfg.Mode,
		AllowedHosts: cfg.AllowedHosts,
		Verifier:     verifier,
		Store:        st,
		Registry:     curriculum.Default(),
		BeforeCommit: opts.BeforeCommit,
	})
	return &Service{cfg: cfg, store: st, handler: h}, nil
}

// Handler returns the v1 HTTP handler.
func (s *Service) Handler() http.Handler {
	return s.handler
}

// ListenAddr returns the configured loopback address that ListenAndServe binds.
func (s *Service) ListenAddr() string {
	return s.cfg.Listen
}

// ListenAndServe binds the configured loopback address and serves until ctx is done, then shuts down.
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
