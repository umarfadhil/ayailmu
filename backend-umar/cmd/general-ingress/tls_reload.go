package main

import (
	"bytes"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"sync"
	"time"
)

// GetCertificate is Go's ordinary TLS reload hook. Each published pair is an
// immutable snapshot. An incomplete/invalid file rotation never replaces it.
type certificateReloader struct {
	mu                      sync.Mutex
	certPath, keyPath, name string
	roots                   *x509.CertPool
	now                     func() time.Time
	current                 *tls.Certificate
}

var invalidOriginCertificate = errors.New("valid origin TLS material unavailable")

func newCertificateReloader(certPath, keyPath string, rootPEM []byte, rootSHA, name string, now func() time.Time) (*certificateReloader, error) {
	block, rest := pem.Decode(rootPEM)
	if block == nil || block.Type != "CERTIFICATE" || len(bytes.TrimSpace(rest)) != 0 || name == "" || now == nil {
		return nil, invalidOriginCertificate
	}
	root, err := x509.ParseCertificate(block.Bytes)
	if err != nil || !root.IsCA {
		return nil, invalidOriginCertificate
	}
	sum := sha256.Sum256(root.Raw)
	if hex.EncodeToString(sum[:]) != rootSHA {
		return nil, invalidOriginCertificate
	}
	pool := x509.NewCertPool()
	pool.AddCert(root)
	c := &certificateReloader{certPath: certPath, keyPath: keyPath, name: name, roots: pool, now: now}
	pair, err := c.load(c.now())
	if err != nil {
		return nil, invalidOriginCertificate
	}
	c.current = pair
	return c, nil
}

func (c *certificateReloader) GetCertificate(hello *tls.ClientHelloInfo) (*tls.Certificate, error) {
	if hello != nil && hello.ServerName != "" && hello.ServerName != c.name {
		return nil, invalidOriginCertificate
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	now := c.now()
	if pair, err := c.load(now); err == nil {
		c.current = pair
	}
	if c.current == nil || c.validate(c.current, now) != nil {
		return nil, invalidOriginCertificate
	}
	return c.current, nil
}

func (c *certificateReloader) load(now time.Time) (*tls.Certificate, error) {
	// Existing permission, ownership, link and size checks are reused for both
	// files. These deployment files are owner-only; values are never logged.
	certificate, err := privateBytes(c.certPath)
	if err != nil {
		return nil, invalidOriginCertificate
	}
	key, err := privateBytes(c.keyPath)
	if err != nil {
		return nil, invalidOriginCertificate
	}
	pair, err := tls.X509KeyPair(certificate, key)
	clear(key)
	if err != nil || len(pair.Certificate) == 0 || len(pair.Certificate) > 8 {
		return nil, invalidOriginCertificate
	}
	pair.Leaf, err = x509.ParseCertificate(pair.Certificate[0])
	if err != nil || c.validate(&pair, now) != nil {
		return nil, invalidOriginCertificate
	}
	return &pair, nil
}

func (c *certificateReloader) validate(pair *tls.Certificate, now time.Time) error {
	if pair == nil || pair.Leaf == nil {
		return invalidOriginCertificate
	}
	intermediates := x509.NewCertPool()
	for _, raw := range pair.Certificate[1:] {
		cert, err := x509.ParseCertificate(raw)
		if err != nil {
			return invalidOriginCertificate
		}
		intermediates.AddCert(cert)
	}
	_, err := pair.Leaf.Verify(x509.VerifyOptions{Roots: c.roots, Intermediates: intermediates, DNSName: c.name, CurrentTime: now, KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}})
	if err != nil {
		return invalidOriginCertificate
	}
	return nil
}
