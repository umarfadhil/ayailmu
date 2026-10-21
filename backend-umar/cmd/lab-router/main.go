// lab-router is a bounded, loopback-only synthetic client router. It never opens a tunnel.
package main

import (
	"context"
	"errors"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/umarfadhil/ayailmu/backend-umar/internal/labconfig"
	"github.com/umarfadhil/ayailmu/backend-umar/internal/tunnelproxy"
)

func main() {
	listen := flag.String("listen", "127.0.0.1:8188", "literal loopback listen address")
	api := flag.String("api", "http://127.0.0.1:8187", "fixed loopback API origin")
	auth := flag.String("auth", "http://127.0.0.1:8287", "fixed loopback GoTrue origin")
	duration := flag.Duration("duration", 30*time.Minute, "lifetime, at most 30m")
	flag.Parse()
	if err := run(*listen, *api, *auth, *duration); err != nil {
		log.Print(err)
		os.Exit(1)
	}
}

func run(listen, api, auth string, duration time.Duration) error {
	if err := labconfig.RouterLimits(listen, duration); err != nil {
		return err
	}
	handler, err := tunnelproxy.New(api, auth)
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	ctx, cancel := context.WithTimeout(ctx, duration)
	defer cancel()
	server := &http.Server{Addr: listen, Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 32768}
	defer server.Close()
	done := make(chan error, 1)
	go func() { done <- server.ListenAndServe() }()
	log.Printf("Synthetic route proxy: %s, lifetime %s. No public tunnel started.", listen, duration)
	select {
	case err := <-done:
		if !errors.Is(err, http.ErrServerClosed) {
			return errors.New("local router failed to listen or serve")
		}
		return nil
	case <-ctx.Done():
		shutdown, finish := context.WithTimeout(context.Background(), 5*time.Second)
		defer finish()
		return server.Shutdown(shutdown)
	}
}
