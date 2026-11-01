package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/pem"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

type tlsFixture struct {
	root              *x509.Certificate
	key               *ecdsa.PrivateKey
	rootPEM           []byte
	pin               string
	certPath, keyPath string
	now               time.Time
}

func newTLSFixture(t *testing.T) tlsFixture {
	t.Helper()
	now := time.Now()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	ca := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "synthetic fixture root"}, NotBefore: now.Add(-24 * time.Hour), NotAfter: now.Add(48 * time.Hour), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign}
	der, err := x509.CreateCertificate(rand.Reader, ca, ca, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	ca, err = x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(der)
	dir := t.TempDir()
	return tlsFixture{ca, key, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), hex.EncodeToString(sum[:]), filepath.Join(dir, "leaf.crt"), filepath.Join(dir, "leaf.key"), now}
}
func (f tlsFixture) pair(t *testing.T, serial int64, host string, end time.Time) ([]byte, []byte) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	leaf := &x509.Certificate{SerialNumber: big.NewInt(serial), DNSNames: []string{host}, NotBefore: f.now.Add(-24 * time.Hour), NotAfter: end, KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	der, err := x509.CreateCertificate(rand.Reader, leaf, f.root, &key.PublicKey, f.key)
	if err != nil {
		t.Fatal(err)
	}
	k, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	cert := append(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), f.rootPEM...)
	return cert, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: k})
}
func (f tlsFixture) write(t *testing.T, cert, key []byte) {
	t.Helper()
	if err := os.WriteFile(f.keyPath, key, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(f.certPath, cert, 0600); err != nil {
		t.Fatal(err)
	}
}
func (f tlsFixture) loader(t *testing.T) *certificateReloader {
	t.Helper()
	c, err := newCertificateReloader(f.certPath, f.keyPath, f.rootPEM, f.pin, "localhost", func() time.Time { return f.now })
	if err != nil {
		t.Fatal(err)
	}
	return c
}
func certificateSerial(t *testing.T, c *certificateReloader) int64 {
	t.Helper()
	pair, err := c.GetCertificate(&tls.ClientHelloInfo{ServerName: "localhost"})
	if err != nil {
		t.Fatal(err)
	}
	return pair.Leaf.SerialNumber.Int64()
}

func TestCertificateRenewalLoadsWithoutRestart(t *testing.T) {
	f := newTLSFixture(t)
	cert, key := f.pair(t, 2, "localhost", f.now.Add(6*time.Hour))
	f.write(t, cert, key)
	c := f.loader(t)
	if certificateSerial(t, c) != 2 {
		t.Fatal("initial leaf mismatch")
	}
	cert, key = f.pair(t, 3, "localhost", f.now.Add(12*time.Hour))
	f.write(t, cert, key)
	if certificateSerial(t, c) != 3 {
		t.Fatal("renewal did not load")
	}
}
func TestInvalidRenewalRetainsLastValidCertificate(t *testing.T) {
	for _, kind := range []string{"malformed", "mismatched", "wrong-ca", "wrong-host", "expired", "unsafe-permissions", "missing"} {
		t.Run(kind, func(t *testing.T) {
			f := newTLSFixture(t)
			cert, key := f.pair(t, 2, "localhost", f.now.Add(6*time.Hour))
			f.write(t, cert, key)
			c := f.loader(t)
			switch kind {
			case "malformed":
				f.write(t, []byte("invalid"), []byte("invalid"))
			case "mismatched":
				newCert, _ := f.pair(t, 3, "localhost", f.now.Add(12*time.Hour))
				f.write(t, newCert, key)
			case "wrong-ca":
				other := newTLSFixture(t)
				newCert, newKey := other.pair(t, 3, "localhost", f.now.Add(12*time.Hour))
				f.write(t, newCert, newKey)
			case "wrong-host":
				newCert, newKey := f.pair(t, 3, "other.invalid", f.now.Add(12*time.Hour))
				f.write(t, newCert, newKey)
			case "expired":
				newCert, newKey := f.pair(t, 3, "localhost", f.now.Add(-time.Hour))
				f.write(t, newCert, newKey)
			case "unsafe-permissions":
				if err := os.Chmod(f.keyPath, 0644); err != nil {
					t.Fatal(err)
				}
			case "missing":
				if err := os.Remove(f.keyPath); err != nil {
					t.Fatal(err)
				}
			}
			if certificateSerial(t, c) != 2 {
				t.Fatal("invalid material replaced valid leaf")
			}
		})
	}
}
func TestCertificateExpiryAndWrongSniFailClosed(t *testing.T) {
	f := newTLSFixture(t)
	cert, key := f.pair(t, 2, "localhost", f.now.Add(time.Hour))
	f.write(t, cert, key)
	now := f.now
	c, err := newCertificateReloader(f.certPath, f.keyPath, f.rootPEM, f.pin, "localhost", func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	if _, err = c.GetCertificate(&tls.ClientHelloInfo{ServerName: "other.invalid"}); err == nil {
		t.Fatal("wrong SNI accepted")
	}
	now = now.Add(2 * time.Hour)
	if _, err = c.GetCertificate(&tls.ClientHelloInfo{ServerName: "localhost"}); err == nil {
		t.Fatal("expired cached leaf accepted")
	}
	if _, err = newCertificateReloader(f.certPath, f.keyPath, f.rootPEM, f.pin, "localhost", func() time.Time { return now }); err == nil {
		t.Fatal("expired initial material accepted")
	}
}
func TestCertificateRootPinAndInitialMismatchFailClosed(t *testing.T) {
	f := newTLSFixture(t)
	cert, key := f.pair(t, 2, "localhost", f.now.Add(time.Hour))
	f.write(t, cert, key)
	if _, err := newCertificateReloader(f.certPath, f.keyPath, f.rootPEM, "invalid", "localhost", time.Now); err == nil {
		t.Fatal("wrong CA pin accepted")
	}
	other := newTLSFixture(t)
	_, otherKey := other.pair(t, 3, "localhost", f.now.Add(time.Hour))
	f.write(t, cert, otherKey)
	if _, err := newCertificateReloader(f.certPath, f.keyPath, f.rootPEM, f.pin, "localhost", time.Now); err == nil {
		t.Fatal("initial key mismatch accepted")
	}
}
func TestConcurrentCertificateRotationHasNoInvalidSnapshots(t *testing.T) {
	f := newTLSFixture(t)
	oldCert, oldKey := f.pair(t, 2, "localhost", f.now.Add(6*time.Hour))
	newCert, newKey := f.pair(t, 3, "localhost", f.now.Add(12*time.Hour))
	f.write(t, oldCert, oldKey)
	c := f.loader(t)
	var wg sync.WaitGroup
	errors := make(chan bool, 256)
	for n := 0; n < 8; n++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < 20; i++ {
				pair, err := c.GetCertificate(&tls.ClientHelloInfo{ServerName: "localhost"})
				if err != nil || pair == nil || pair.Leaf == nil || pair.Leaf.SerialNumber.Int64() < 2 || pair.Leaf.SerialNumber.Int64() > 3 {
					errors <- true
				}
			}
		}()
	}
	for i := 0; i < 10; i++ {
		f.write(t, newCert, newKey)
		f.write(t, oldCert, oldKey)
	}
	f.write(t, newCert, newKey)
	wg.Wait()
	close(errors)
	if len(errors) > 0 {
		t.Fatal("invalid concurrent certificate returned")
	}
	if certificateSerial(t, c) != 3 {
		t.Fatal("final renewal unavailable")
	}
}
func TestRealTlsHandshakeUsesRenewedCertificateWithoutListener(t *testing.T) {
	f := newTLSFixture(t)
	cert, key := f.pair(t, 2, "localhost", f.now.Add(6*time.Hour))
	f.write(t, cert, key)
	c := f.loader(t)
	pool := x509.NewCertPool()
	pool.AppendCertsFromPEM(f.rootPEM)
	for _, serial := range []int64{2, 3} {
		if serial == 3 {
			cert, key = f.pair(t, 3, "localhost", f.now.Add(12*time.Hour))
			f.write(t, cert, key)
		}
		serverWire, clientWire := net.Pipe()
		serverWire.SetDeadline(time.Now().Add(2 * time.Second))
		clientWire.SetDeadline(time.Now().Add(2 * time.Second))
		server := tls.Server(serverWire, &tls.Config{MinVersion: tls.VersionTLS12, GetCertificate: c.GetCertificate})
		client := tls.Client(clientWire, &tls.Config{MinVersion: tls.VersionTLS12, RootCAs: pool, ServerName: "localhost", Time: func() time.Time { return f.now }})
		done := make(chan error, 1)
		go func() { done <- server.Handshake() }()
		err := client.Handshake()
		serverErr := <-done
		if err != nil || serverErr != nil {
			serverWire.Close()
			clientWire.Close()
			t.Fatal("TLS handshake failed", err, serverErr)
		}
		if client.ConnectionState().PeerCertificates[0].SerialNumber.Int64() != serial {
			t.Fatal("stale certificate used")
		}
		serverWire.Close()
		clientWire.Close()
	}
}
