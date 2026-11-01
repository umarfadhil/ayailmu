// general-ingress is a separately configured local TLS gateway. Its default
// action only validates non-secret configuration. It never starts a tunnel,
// creates a key/account or migrates/reloads the backend. Fresh accounting setup
// requires its separate explicit initialize-ledger action and cannot reset one.
package main

import (
	"context"
	"crypto/tls"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	ingress "github.com/umarfadhil/ayailmu/backend-umar/internal/generalingress"
)

type wallClock struct{ start time.Time }

func (c wallClock) Now() time.Time         { return time.Now() }
func (c wallClock) Elapsed() time.Duration { return time.Since(c.start) }

// Used only after explicit local serving activation, never config validation.
// No symlink, shared-mode, unrelated-owner or hard-linked secret file is read.
func privateBytes(path string) ([]byte, error) {
	fd, err := syscall.Open(path, syscall.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0)
	if err != nil {
		return nil, errors.New("private input unavailable")
	}
	f := os.NewFile(uintptr(fd), "private input")
	defer f.Close()
	s, err := f.Stat()
	if err != nil || !s.Mode().IsRegular() || s.Mode().Perm() != 0600 || s.Size() > 65536 {
		return nil, errors.New("private input permissions invalid")
	}
	st, ok := s.Sys().(*syscall.Stat_t)
	if !ok || st.Uid != uint32(os.Getuid()) || st.Nlink != 1 {
		return nil, errors.New("private input ownership invalid")
	}
	return io.ReadAll(io.LimitReader(f, 65537))
}
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(1)
	}
}
func run() error {
	configPath := flag.String("config", "", "explicit non-secret runtime JSON")
	serve := flag.Bool("serve", false, "explicitly serve local TLS after approved configuration")
	validateTLS := flag.Bool("validate-tls", false, "validate existing TLS files only; no listener, provider or ledger")
	tlsName := flag.String("tls-server-name", "localhost", "existing origin certificate hostname")
	initializeLedger := flag.Bool("initialize-ledger", false, "explicitly initialize one new approved accounting policy; never reset")
	rootPath := flag.String("root-ca", "", "existing public upstream CA certificate")
	certPath := flag.String("tls-cert", "", "existing local server certificate")
	tlsKeyPath := flag.String("tls-key", "", "existing private local server key")
	accountingPath := flag.String("accounting-key", "", "existing dedicated private accounting key")
	ledgerPath := flag.String("ledger", "", "existing initialized private accounting directory")
	keyID := flag.String("accounting-key-id", "", "immutable dedicated accounting key identifier")
	scope := flag.String("accounting-scope", "", "immutable accounting policy scope")
	flag.Parse()
	if (*serve && *initializeLedger) || (*validateTLS && (*serve || *initializeLedger)) {
		return errors.New("serving, TLS validation and ledger initialization are separate actions")
	}
	if *configPath == "" {
		return errors.New("explicit configuration required; no service started")
	}
	raw, err := os.ReadFile(*configPath)
	if err != nil {
		return errors.New("configuration unavailable")
	}
	clock := wallClock{time.Now()}
	c, err := ingress.ParseRuntimeConfig(raw, clock.Now())
	if err != nil {
		return errors.New("configuration invalid; no service started")
	}
	if !*serve && !*initializeLedger && !*validateTLS {
		fmt.Println("configuration valid; no listener, provider, credential or ledger accessed")
		return nil
	}
	if !c.Enabled {
		return errors.New("runtime disabled; no service started")
	}
	if *initializeLedger {
		if _, _, err := accounting(c, clock.Now(), *accountingPath, *ledgerPath, *keyID, *scope, true); err != nil {
			return err
		}
		fmt.Println("new accounting policy initialized; no listener, provider or mail accessed")
		return nil
	}
	root, err := os.ReadFile(*rootPath)
	if err != nil {
		return errors.New("existing upstream CA unavailable")
	}
	identity, err := newCertificateReloader(*certPath, *tlsKeyPath, root, c.CAHash, *tlsName, time.Now)
	if err != nil {
		return err
	}
	if *validateTLS {
		fmt.Println("existing TLS certificate and key valid; no listener, provider or ledger accessed")
		return nil
	}
	// This binary has no privileged session-status read path. Bounded JWT mode
	// uses existing provider authority; immediate mode needs a reviewed adapter.
	if c.Revocation != ingress.AllowBoundedJWT {
		return errors.New("authoritative session-status adapter is not configured")
	}
	var budget *ingress.Budget
	var keyer ingress.IdentityKeyer
	if c.Policy.MailEnabled || *accountingPath != "" || *ledgerPath != "" || *keyID != "" || *scope != "" {
		budget, keyer, err = accounting(c, clock.Now(), *accountingPath, *ledgerPath, *keyID, *scope, false)
		if err != nil {
			return err
		}
	}
	p, b, err := ingress.NewRuntimeHTTPAdapters(c, clock, root, nil, budget, keyer)
	if err != nil {
		return errors.New("private provider configuration invalid")
	}
	e, err := ingress.NewRuntime(c, clock, p, p, b)
	if err != nil {
		return errors.New("runtime composition invalid")
	}
	defer e.Stop()
	defer p.CloseIdleConnections()
	h, err := ingress.NewRuntimeHandler(c, e)
	if err != nil {
		return errors.New("HTTP boundary unavailable")
	}
	server, err := ingress.RuntimeServer(c, h, clock.Now())
	if err != nil {
		return errors.New("local TLS server unavailable")
	}
	server.TLSConfig.GetCertificate = identity.GetCertificate
	signalCtx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	ctx, stop := context.WithCancel(signalCtx)
	defer stop()
	server.BaseContext = func(net.Listener) context.Context { return ctx }
	// No socket is created before every configuration, TLS and accounting check.
	listener, err := net.Listen("tcp", c.Listen)
	if err != nil {
		return errors.New("loopback listener unavailable")
	}
	defer listener.Close()
	done := make(chan error, 1)
	go func() { done <- server.Serve(tls.NewListener(listener, server.TLSConfig)) }()
	select {
	case err = <-done:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			return errors.New("local TLS server stopped")
		}
	case <-ctx.Done():
		e.Stop()
		shutdown, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if server.Shutdown(shutdown) != nil {
			server.Close()
		}
		<-done
	}
	return nil
}

func accounting(c ingress.RuntimeConfig, now time.Time, keyPath, ledgerPath, keyID, scope string, initialize bool) (*ingress.Budget, ingress.IdentityKeyer, error) {
	if !c.Enabled || !c.Policy.MailEnabled || c.Validate(now) != nil {
		return nil, nil, errors.New("accounting policy not enabled")
	}
	if !initialize && keyPath == "" && ledgerPath == "" && keyID == "" && scope == "" {
		return nil, nil, nil
	}
	if keyPath == "" || ledgerPath == "" || keyID == "" || scope == "" {
		return nil, nil, errors.New("explicit durable accounting configuration incomplete")
	}
	key, err := privateBytes(keyPath)
	if err != nil {
		return nil, nil, err
	}
	keyer, err := ingress.NewRuntimeKeyer(true, keyID, scope, key)
	clear(key)
	if err != nil {
		return nil, nil, errors.New("dedicated accounting input invalid")
	}
	disk, err := ingress.NewFileJournal(ledgerPath)
	if err != nil {
		return nil, nil, errors.New("accounting store unavailable")
	}
	policy := ingress.BudgetPolicy{Scope: scope, Global: c.Policy.MailGlobal, RecipientHour: c.Policy.MailRecipientHour, IPHour: c.Policy.MailIPHour, Cooldown: c.Policy.MailCooldown, IdentityBinding: keyer.PolicyBinding()}
	budget, err := ingress.NewRuntimeBudget(true, policy, disk)
	if err != nil {
		return nil, nil, errors.New("accounting policy invalid")
	}
	if initialize {
		err = budget.Initialize(context.Background(), now)
	} else {
		err = budget.Check(context.Background(), now)
	}
	if err != nil {
		return nil, nil, errors.New("accounting store unavailable or immutable policy mismatch")
	}
	return budget, keyer, nil
}
