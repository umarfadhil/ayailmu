package generalingress

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net"
)

// Standard-library HMAC; no key generation, environment/file credential read,
// or production key configuration. Tests use public RFC 4231 vector bytes.
type HMACKeyer struct {
	runtime   bool
	id, scope string
	key       []byte
}

func NewHMACKeyer(simulation bool, id, scope string, key []byte) (*HMACKeyer, error) {
	if !simulation || !opaqueKey.MatchString(id) || !opaqueKey.MatchString(scope) || len(key) < 32 || len(key) > 1024 {
		return nil, ErrStorage
	}
	return &HMACKeyer{id: id, scope: scope, key: append([]byte(nil), key...)}, nil
}
func (k *HMACKeyer) OfflineOnly() bool { return !k.runtime }
func (HMACKeyer) String() string       { return "IdentityKeyer(redacted)" }
func (k *HMACKeyer) digest(domain, value string) string {
	m := hmac.New(sha256.New, k.key)
	m.Write([]byte("ayailmu-mail-v1\x00" + k.id + "\x00" + k.scope + "\x00" + domain + "\x00" + value))
	return hex.EncodeToString(m.Sum(nil))
}
func (k *HMACKeyer) PolicyBinding() string { return k.digest("policy-binding", "") }
func (k *HMACKeyer) Key(kind, value string) (string, error) {
	canonical := ""
	switch kind {
	case "recipient":
		var ok bool
		canonical, ok = email(value)
		if !ok {
			return "", ErrStorage
		}
	case "ip":
		ip := net.ParseIP(value)
		if ip == nil {
			return "", ErrStorage
		}
		canonical = ip.String()
	default:
		return "", ErrStorage
	}
	return k.digest(kind, canonical), nil
}
