// Explicit, one-shot migration process; never starts HTTP or configures authentication.
package main

import (
	"context"
	"errors"
	"log"
	"os"
	"time"

	"github.com/umarfadhil/ayailmu/backend-umar/internal/catalog"
	"github.com/umarfadhil/ayailmu/backend-umar/internal/store"
)

func main() {
	if err := run(); err != nil {
		log.Print(err)
		os.Exit(1)
	}
}

func run() error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	registry, err := catalog.Load()
	if err != nil {
		return errors.New("catalog initialization failed")
	}
	s, err := store.Open(ctx, os.Getenv("UMAR_DATABASE_URL"), registry)
	if err != nil {
		return err
	}
	defer s.Close()
	if err = s.Prepare(ctx, true); err != nil {
		return errors.New("database migration or verification failed")
	}
	log.Print("Umar synthetic schema and registry verified; no HTTP service started")
	return nil
}
