package main

import (
	"context"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

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
	provider := env("UMAR_AUTH_PROVIDER", "gotrue")
	issuer, jwks, audience := "http://127.0.0.1:8287", "http://127.0.0.1:8287/.well-known/jwks.json", "authenticated"
	if provider == "keycloak" {
		issuer, jwks, audience = "http://127.0.0.1:8285/realms/umar", "http://127.0.0.1:8285/realms/umar/protocol/openid-connect/certs", "umar-api"
	}
	issuer, err = labconfig.Issuer(provider, os.Getenv("UMAR_PUBLIC_ORIGIN"), os.Getenv("UMAR_OIDC_ISSUER"), issuer)
	if err != nil {
		return err
	}
	v, err := auth.New(ctx, auth.Config{Provider: provider, Issuer: issuer, JWKSURL: env("UMAR_OIDC_JWKS_URL", jwks), Audience: audience, ClientID: "umar-native", AllowLoopbackHTTP: true})
	if err != nil {
		return err
	}
	r, err := catalog.Load()
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
	if err = s.Migrate(startup); err != nil {
		return errors.New("database migration failed")
	}
	server := &http.Server{Addr: addr, Handler: api.New(s, v, r), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 32768}
	done := make(chan error, 1)
	go func() {
		log.Printf("Umar synthetic-only API listening at http://%s", addr)
		done <- server.ListenAndServe()
	}()
	select {
	case err = <-done:
		if !errors.Is(err, http.ErrServerClosed) {
			return errors.New("HTTP server failed")
		}
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return server.Shutdown(shutdown)
	}
	return nil
}
