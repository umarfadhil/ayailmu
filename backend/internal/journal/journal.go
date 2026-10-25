// Package journal is a durable stand-alone client journal: the local store of one simulated device,
// used to exercise real sync against the API without changing the Expo or Android apps.
//
// A journal file holds the device's identity; its local originals (exact envelope bytes, never deleted,
// exact repeats kept); which of them the server has acknowledged; the device's one guest import, frozen
// as exact request bytes before it is first sent; the linked profile and the settings base (the
// server's revision and settings when the device linked or last pushed); the pull cursor; events pulled
// from other devices (exact payload bytes); local settings and consent; and an opaque local session
// state that never leaves the device. Every change is written to a new file, synced and renamed over the
// journal (mode 0600), so a crash leaves the old or the new state. Bearer tokens are never stored: a
// Client carries one for a single call.
//
// Settings stay local until PushSettings sends the members that differ from the base as a conditional
// RFC 7396 patch. A stale base is never merged automatically: the push fails with *SettingsConflict and
// the local settings stay as they are, until RebaseSettings resolves the conflict explicitly.
package journal

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"ayailmu.local/backend/internal/curriculum"
	"ayailmu.local/backend/internal/envelope"
)

// Errors. None of them, and nothing wrapped in them, quotes a token, a request body or response text.
var (
	ErrClosed            = errors.New("journal: closed")
	ErrInvalidDevice     = errors.New("journal: a device needs a registered family of its app, and install and local profile IDs of 1 to 128 bytes")
	ErrDeviceMismatch    = errors.New("journal: the journal file belongs to another device")
	ErrCorrupt           = errors.New("journal: the journal file is unreadable")
	ErrEnvelopeTooLarge  = errors.New("journal: an envelope may hold at most 1 MiB")
	ErrForeignEvent      = errors.New("journal: the envelope is not of this device's family and source")
	ErrNULText           = errors.New("journal: curriculum and source text may not contain U+0000")
	ErrConflictingRecord = errors.New("journal: an event with this ID and other content is already recorded")
	ErrInvalidSettings   = errors.New("journal: instruction_lang is id or en, session_minutes 1 to 240 and arabic_scale 0.8 to 2.0")
	ErrInvalidConsent    = errors.New("journal: consent needs a version of 1 to 128 bytes and an RFC 3339 time")
	ErrNoConsent         = errors.New("journal: record the guest's consent before the first sync creates a profile")
	ErrInvalidClient     = errors.New("journal: a client needs a loopback http base URL without credentials, path, query or fragment, and a token")
	ErrLinkMismatch      = errors.New("journal: the device is linked to, or its pending import targets, another profile")
	ErrNotLinked         = errors.New("journal: the device is not linked to a profile yet; sync first")
	ErrNotAConflict      = errors.New("journal: not a settings conflict with a server revision and valid settings")
	ErrUnverifiedReceipt = errors.New("journal: the import receipt does not match the request; nothing was acknowledged")
	ErrBadResponse       = errors.New("journal: the server's response does not match the request")
	ErrRefused           = errors.New("journal: the server refused the request")
	ErrUnacknowledged    = errors.New("journal: some events were not acknowledged and stay pending")
)

// maxEnvelopeBytes bounds one recorded envelope, so any envelope fits in an upload batch. A payload holds
// at most 64 KiB; the rest is room for formatting.
const maxEnvelopeBytes = 1 << 20

// Device identifies the simulated install. Family is the only family it records and pulls.
type Device struct {
	App            string
	Family         string
	InstallID      string
	LocalProfileID string
}

// Settings are the profile settings a device may edit; nil means unset.
type Settings struct {
	InstructionLang *string  `json:"instruction_lang,omitempty"`
	SessionMinutes  *int     `json:"session_minutes,omitempty"`
	ArabicScale     *float64 `json:"arabic_scale,omitempty"`
}

// Consent is the guest's local consent record, sent once when an import creates a profile.
type Consent struct {
	Version string `json:"version"`
	At      string `json:"at"`
}

// RemoteEvent is an event pulled from another device, kept with its exact payload bytes.
type RemoteEvent struct {
	Seq            int64
	EventID        string
	InstallID      string
	LocalProfileID string
	Payload        []byte
}

// Client reaches the local API as one signed-in account. BaseURL is a loopback http URL such as
// http://127.0.0.1:8091. The token is used for this call's requests only and never stored. HTTP may set
// a transport or timeout; redirects are never followed.
type Client struct {
	BaseURL string
	Token   string
	HTTP    *http.Client
}

// SyncOptions select how an unlinked device links: by default an import creates a profile from the local
// settings and consent; LinkProfileID links into an existing profile of the same account instead, with
// no settings or consent of its own.
type SyncOptions struct {
	LinkProfileID string
}

// SyncReport summarizes one Sync.
type SyncReport struct {
	Imported  bool     // the device's import was acknowledged in this sync
	Replayed  bool     // and the server replayed it: an earlier attempt had committed
	Stored    int      // events the server stored, by the import and by uploads
	Identical int      // events the server already held
	Conflicts []string // IDs of events whose stored copy differs; they stay pending
	Pulled    int      // events of other devices added to Remote
}

// SettingsConflict reports a settings push refused because the server profile changed since the
// device's base revision. Revision and Server are the profile's current revision and settings. The local
// settings and the base are left as they were; RebaseSettings resolves the conflict.
type SettingsConflict struct {
	Revision int64
	Server   Settings
}

func (e *SettingsConflict) Error() string {
	return "journal: the profile settings changed on the server since this device's base revision"
}

// Journal is one device's durable local store. Its methods are safe for concurrent use; Sync and
// PushSettings hold the journal while their requests run.
type Journal struct {
	mu     sync.Mutex
	path   string
	reg    *curriculum.Registry
	st     fileState
	closed bool
}

// Open opens the journal file at path for dev, creating it when it does not exist. An existing file must
// belong to the same device.
func Open(path string, dev Device) (*Journal, error) {
	reg := curriculum.Default()
	if fam, ok := reg.Family(dev.Family); !ok || fam.App != dev.App || !idText(dev.InstallID) || !idText(dev.LocalProfileID) {
		return nil, ErrInvalidDevice
	}
	j := &Journal{path: path, reg: reg}
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		j.st = fileState{Format: fileFormat, Device: dev}
		if err := writeState(path, j.st); err != nil {
			return nil, err
		}
		return j, nil
	}
	if err != nil {
		return nil, fmt.Errorf("journal: read the journal file: %w", err)
	}
	if err := json.Unmarshal(data, &j.st); err != nil || !j.st.consistent() {
		return nil, ErrCorrupt
	}
	if j.st.Device != dev {
		return nil, ErrDeviceMismatch
	}
	return j, nil
}

// Close closes the journal. Every change was already written; closing twice is harmless.
func (j *Journal) Close() error {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.closed = true
	return nil
}

// Record stores a locally created envelope, exact bytes, and queues its event for upload. The envelope
// must pass the server's own checks and come from this device's family and source. A repeat of an event
// with the same content is kept as another original; the same ID with other content is refused.
func (j *Journal) Record(env []byte) error {
	j.mu.Lock()
	defer j.mu.Unlock()
	if j.closed {
		return ErrClosed
	}
	if len(env) > maxEnvelopeBytes {
		return ErrEnvelopeTooLarge
	}
	ev, err := envelope.Parse(env, j.reg)
	if err != nil {
		return fmt.Errorf("journal: the envelope is invalid: %w", err)
	}
	dev := j.st.Device
	if ev.Curriculum.Family != dev.Family || ev.Source.App != dev.App || ev.Source.InstallID != dev.InstallID ||
		ev.Source.LocalProfileID != dev.LocalProfileID {
		return ErrForeignEvent
	}
	for _, s := range []string{ev.Curriculum.Track, ev.Curriculum.ContentVersion, ev.Curriculum.RulesVersion, ev.Source.AppVersion} {
		if strings.IndexByte(s, 0) >= 0 {
			return ErrNULText
		}
	}
	sum := hex.EncodeToString(ev.SemanticSHA256[:])
	for _, o := range j.st.Originals {
		if o.EventID == ev.EventID && o.SemanticSHA256 != sum {
			return ErrConflictingRecord
		}
	}
	return j.commit(func(st *fileState) error {
		st.Originals = append(st.Originals, original{EventID: ev.EventID, SemanticSHA256: sum, Envelope: bytes.Clone(env)})
		return nil
	})
}

// SetSessionState replaces the local session state. It never leaves the device.
func (j *Journal) SetSessionState(state []byte) error {
	j.mu.Lock()
	defer j.mu.Unlock()
	if j.closed {
		return ErrClosed
	}
	return j.commit(func(st *fileState) error {
		st.Session = bytes.Clone(state)
		return nil
	})
}

// SessionState returns a copy of the local session state.
func (j *Journal) SessionState() []byte {
	j.mu.Lock()
	defer j.mu.Unlock()
	return bytes.Clone(j.st.Session)
}

// SetConsent records the guest's local consent. Only an import that creates a profile sends it, as it
// was when that import was frozen.
func (j *Journal) SetConsent(c Consent) error {
	j.mu.Lock()
	defer j.mu.Unlock()
	if j.closed {
		return ErrClosed
	}
	if !idText(c.Version) {
		return ErrInvalidConsent
	}
	if _, err := time.Parse(time.RFC3339Nano, c.At); err != nil {
		return ErrInvalidConsent
	}
	return j.commit(func(st *fileState) error {
		st.Consent = &c
		return nil
	})
}

// SetSettings replaces the local settings. PushSettings sends them to a linked profile; an import that
// creates a profile sends them as they were when it was frozen. Nothing else reads or changes them.
func (j *Journal) SetSettings(s Settings) error {
	j.mu.Lock()
	defer j.mu.Unlock()
	if j.closed {
		return ErrClosed
	}
	if err := validSettings(s); err != nil {
		return err
	}
	local := cloneSettings(s)
	return j.commit(func(st *fileState) error {
		st.Settings = local
		return nil
	})
}

// Settings returns a copy of the local settings.
func (j *Journal) Settings() Settings {
	j.mu.Lock()
	defer j.mu.Unlock()
	return cloneSettings(j.st.Settings)
}

// Originals returns every locally recorded envelope, exact bytes, in record order.
func (j *Journal) Originals() [][]byte {
	j.mu.Lock()
	defer j.mu.Unlock()
	if len(j.st.Originals) == 0 {
		return nil
	}
	out := make([][]byte, len(j.st.Originals))
	for i, o := range j.st.Originals {
		out[i] = bytes.Clone(o.Envelope)
	}
	return out
}

// Pending returns the IDs of recorded events the server has not acknowledged, in record order; a
// repeated event appears once per copy.
func (j *Journal) Pending() []string {
	j.mu.Lock()
	defer j.mu.Unlock()
	var ids []string
	for _, o := range j.st.Originals {
		if !o.Acked {
			ids = append(ids, o.EventID)
		}
	}
	return ids
}

// ImportID returns the device's import ID: "" until its first link attempt is frozen, then the same ID
// for good, unless the server refused that import outright.
func (j *Journal) ImportID() string {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.st.ImportID
}

// ProfileID returns the linked server profile, or "" while unlinked.
func (j *Journal) ProfileID() string {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.st.ProfileID
}

// Cursor returns the last pulled sequence number of the device's family.
func (j *Journal) Cursor() int64 {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.st.Cursor
}

// Remote returns copies of the events pulled from other devices, in sequence order.
func (j *Journal) Remote() []RemoteEvent {
	j.mu.Lock()
	defer j.mu.Unlock()
	if len(j.st.Remote) == 0 {
		return nil
	}
	out := make([]RemoteEvent, len(j.st.Remote))
	for i, r := range j.st.Remote {
		out[i] = RemoteEvent{Seq: r.Seq, EventID: r.EventID, InstallID: r.InstallID, LocalProfileID: r.LocalProfileID, Payload: bytes.Clone(r.Payload)}
	}
	return out
}

// RebaseSettings resolves a SettingsConflict explicitly: the server's revision and settings in c become
// the base, and the local settings stay as they are. PushSettings then sends exactly the members the
// local settings still change, conditional on that revision. To take the server's values instead, call
// SetSettings(c.Server) as well; PushSettings then sends nothing.
func (j *Journal) RebaseSettings(c *SettingsConflict) error {
	j.mu.Lock()
	defer j.mu.Unlock()
	if j.closed {
		return ErrClosed
	}
	if j.st.ProfileID == "" {
		return ErrNotLinked
	}
	if c == nil || c.Revision < 1 || validSettings(c.Server) != nil {
		return ErrNotAConflict
	}
	base := settingsBase{Revision: c.Revision, Settings: cloneSettings(c.Server)}
	return j.commit(func(st *fileState) error {
		st.Base = &base
		return nil
	})
}

func validSettings(s Settings) error {
	switch {
	case s.InstructionLang != nil && *s.InstructionLang != "id" && *s.InstructionLang != "en",
		s.SessionMinutes != nil && (*s.SessionMinutes < 1 || *s.SessionMinutes > 240),
		s.ArabicScale != nil && !(*s.ArabicScale >= 0.8 && *s.ArabicScale <= 2.0):
		return ErrInvalidSettings
	}
	return nil
}

func cloneSettings(s Settings) Settings {
	return Settings{InstructionLang: clonePtr(s.InstructionLang), SessionMinutes: clonePtr(s.SessionMinutes), ArabicScale: clonePtr(s.ArabicScale)}
}

func clonePtr[T any](p *T) *T {
	if p == nil {
		return nil
	}
	v := *p
	return &v
}

// idText bounds identifiers like the server does: 1 to 128 bytes of UTF-8 without NUL.
func idText(s string) bool {
	return s != "" && len(s) <= 128 && utf8.ValidString(s) && strings.IndexByte(s, 0) < 0
}
