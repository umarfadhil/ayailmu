package journal

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"

	"ayailmu.local/backend/internal/envelope"
)

// Server limits (backend/docs/Backend_Local_Contract.md §5 to §7).
const (
	maxImportEvents = 10000
	maxImportBytes  = 16 << 20
	maxBatchEvents  = 500
	maxBatchBytes   = 4 << 20
	pullLimit       = 500
)

type sourceDoc struct {
	App            string `json:"app"`
	InstallID      string `json:"install_id"`
	LocalProfileID string `json:"local_profile_id"`
}

type newProfile struct {
	Kind     string   `json:"kind"`
	Settings Settings `json:"settings"`
	Consent  Consent  `json:"consent"`
}

type receiptDoc struct {
	ImportID       string `json:"import_id"`
	ProfileID      string `json:"profile_id"`
	Replayed       bool   `json:"replayed"`
	Stored         *int   `json:"stored"`
	Identical      *int   `json:"identical"`
	EventIDsSHA256 string `json:"event_ids_sha256"`
}

type profileDoc struct {
	ProfileID string   `json:"profile_id"`
	Revision  int64    `json:"revision"`
	Settings  Settings `json:"settings"`
}

type resultDoc struct {
	Index          *int   `json:"index"`
	EventID        string `json:"event_id"`
	Result         string `json:"result"`
	Status         int    `json:"status"`
	SemanticSHA256 string `json:"semantic_sha256"`
}

type pageDoc struct {
	Events    []pulledEvent `json:"events"`
	NextAfter *int64        `json:"next_after"`
	HasMore   bool          `json:"has_more"`
}

// pulledEvent keeps the payload as its exact bytes from the response.
type pulledEvent struct {
	Seq        int64               `json:"seq"`
	EventID    string              `json:"event_id"`
	Kind       string              `json:"kind"`
	Curriculum envelope.Curriculum `json:"curriculum"`
	Source     envelope.Source     `json:"source"`
	Payload    json.RawMessage     `json:"payload"`
}

type remoteKey struct{ install, local, event string }

// Sync links the device if needed, uploads its unacknowledged events, then pulls its family's new events
// from other devices.
//
// The first link is the device's guest import (see link). Uploads start only once the link is saved. An
// event is acknowledged only by a stored or identical result for that very event and hash; a conflict or
// any other result leaves it pending, and Sync reports ErrUnacknowledged after pulling. Sync never
// changes the local settings, the settings base after linking, or the session state.
func (j *Journal) Sync(ctx context.Context, c *Client, opts SyncOptions) (SyncReport, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	var rep SyncReport
	if j.closed {
		return rep, ErrClosed
	}
	a, err := newAPI(c)
	if err != nil {
		return rep, err
	}
	if err := j.link(ctx, a, strings.ToLower(opts.LinkProfileID), &rep); err != nil {
		return rep, err
	}
	if j.st.Base == nil {
		if err := j.fetchBase(ctx, a); err != nil {
			return rep, err
		}
	}
	pending, err := j.upload(ctx, a, &rep)
	if err != nil {
		return rep, err
	}
	if err := j.pull(ctx, a, &rep); err != nil {
		return rep, err
	}
	if pending > 0 {
		return rep, ErrUnacknowledged
	}
	return rep, nil
}

// link makes sure the device is linked to a profile. Its first link is its guest import: frozen and saved
// before it is first sent, sent again byte for byte on every retry, after a lost response or a reopen,
// whatever was recorded or edited since, and acknowledged only by a receipt that verifies. A refusal that
// proves nothing was written drops the frozen request, so a later sync builds a new one; any other
// failure keeps it, because the import may have committed.
func (j *Journal) link(ctx context.Context, a *api, target string, rep *SyncReport) error {
	if j.st.ProfileID != "" {
		if target != "" && target != j.st.ProfileID {
			return ErrLinkMismatch
		}
		return nil
	}
	if j.st.Frozen == nil {
		if err := j.freezeImport(target); err != nil {
			return err
		}
	} else if target != "" && target != j.st.Frozen.Target {
		return ErrLinkMismatch
	}
	status, body, err := a.send(ctx, http.MethodPost, "/v1/imports", "application/json", "", j.st.Frozen.Body)
	if err != nil {
		return err
	}
	if status != http.StatusOK && status != http.StatusCreated {
		if nothingWritten(status, problemCode(body)) {
			if err := j.commit(func(st *fileState) error {
				st.Frozen, st.ImportID = nil, ""
				return nil
			}); err != nil {
				return err
			}
		}
		return refused("import", status, body)
	}
	receipt, ok := j.verifyReceipt(status, body)
	if !ok {
		return ErrUnverifiedReceipt
	}
	if err := j.commit(func(st *fileState) error {
		for _, i := range st.Frozen.Members {
			st.Originals[i].Acked = true
		}
		st.ProfileID, st.Frozen = strings.ToLower(receipt.ProfileID), nil
		return nil
	}); err != nil {
		return err
	}
	rep.Imported, rep.Replayed = true, receipt.Replayed
	rep.Stored += *receipt.Stored
	rep.Identical += *receipt.Identical
	return nil
}

// nothingWritten reports an import refusal that proves nothing was written and that the same request
// would be refused again. import_id_reused does not qualify: another request with this ID committed.
func nothingWritten(status int, code string) bool {
	switch status {
	case http.StatusBadRequest, http.StatusNotFound, http.StatusRequestEntityTooLarge, http.StatusUnprocessableEntity:
		return true
	case http.StatusConflict:
		return code != "import_id_reused"
	}
	return false
}

// freezeImport builds the device's import request from its unacknowledged originals, oldest first and
// within the server's import limits, and saves it before it is first sent. The envelopes are written
// verbatim: encoding/json would compact them. A link to target carries no settings or consent; a new
// profile carries the local settings and consent as they are now.
func (j *Journal) freezeImport(target string) error {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return fmt.Errorf("journal: make an import ID: %w", err)
	}
	importID := "imp-" + hex.EncodeToString(raw)
	var targetJSON []byte
	var err error
	if target != "" {
		targetJSON, err = json.Marshal(struct {
			ProfileID string `json:"profile_id"`
		}{ProfileID: target})
	} else {
		if j.st.Consent == nil {
			return ErrNoConsent
		}
		targetJSON, err = json.Marshal(struct {
			NewProfile newProfile `json:"new_profile"`
		}{NewProfile: newProfile{Kind: "adult", Settings: j.st.Settings, Consent: *j.st.Consent}})
	}
	if err != nil {
		return fmt.Errorf("journal: encode the import: %w", err)
	}
	dev := j.st.Device
	head, err := json.Marshal(struct {
		ImportID string    `json:"import_id"`
		Source   sourceDoc `json:"source"`
	}{ImportID: importID, Source: sourceDoc{App: dev.App, InstallID: dev.InstallID, LocalProfileID: dev.LocalProfileID}})
	if err != nil {
		return fmt.Errorf("journal: encode the import: %w", err)
	}
	var body bytes.Buffer
	body.Write(head[:len(head)-1]) // everything but the closing brace
	body.WriteString(`,"target":`)
	body.Write(targetJSON)
	body.WriteString(`,"events":[`)
	members := []int{}
	for i, o := range j.st.Originals {
		if o.Acked {
			continue
		}
		if len(members) == maxImportEvents || (len(members) > 0 && body.Len()+1+len(o.Envelope)+2 > maxImportBytes) {
			break // the rest stay pending and go up as event uploads once the device is linked
		}
		if len(members) > 0 {
			body.WriteByte(',')
		}
		body.Write(o.Envelope)
		members = append(members, i)
	}
	body.WriteString("]}")
	frozen := frozenImport{Body: body.Bytes(), Members: members, Target: target}
	return j.commit(func(st *fileState) error {
		st.ImportID, st.Frozen = importID, &frozen
		return nil
	})
}

// verifyReceipt accepts a receipt only when it answers the frozen request: its import ID, a 201 first
// commit or a 200 replay, counts covering every event sent, the checksum over every event ID sent
// (repeats included) and, for a link, the targeted profile.
func (j *Journal) verifyReceipt(status int, body []byte) (receiptDoc, bool) {
	var r receiptDoc
	if json.Unmarshal(body, &r) != nil || r.Stored == nil || r.Identical == nil {
		return r, false
	}
	f := j.st.Frozen
	ids := make([]string, len(f.Members))
	for k, i := range f.Members {
		ids[k] = j.st.Originals[i].EventID
	}
	profile := strings.ToLower(r.ProfileID)
	return r, r.ImportID == j.st.ImportID && r.Replayed == (status == http.StatusOK) &&
		*r.Stored >= 0 && *r.Identical >= 0 && *r.Stored+*r.Identical == len(ids) &&
		r.EventIDsSHA256 == idsChecksum(ids) && validUUID(profile) && (f.Target == "" || profile == f.Target)
}

// idsChecksum is the receipt checksum the server computes: SHA-256 of the event IDs sent, repeats
// included, sorted bytewise and joined by newlines, in lowercase hex.
func idsChecksum(ids []string) string {
	sorted := slices.Clone(ids)
	slices.Sort(sorted)
	sum := sha256.Sum256([]byte(strings.Join(sorted, "\n")))
	return hex.EncodeToString(sum[:])
}

// fetchBase reads the linked profile once and keeps its revision and settings as the base for later
// pushes. The local settings are not touched.
func (j *Journal) fetchBase(ctx context.Context, a *api) error {
	status, body, err := a.send(ctx, http.MethodGet, "/v1/profiles/"+j.st.ProfileID, "", "", nil)
	if err != nil {
		return err
	}
	if status != http.StatusOK {
		return refused("profile read", status, body)
	}
	var doc profileDoc
	if json.Unmarshal(body, &doc) != nil {
		return ErrBadResponse
	}
	base, ok := j.baseOf(doc)
	if !ok {
		return ErrBadResponse
	}
	return j.commit(func(st *fileState) error {
		st.Base = &base
		return nil
	})
}

// baseOf checks a document of the linked profile and turns it into a settings base.
func (j *Journal) baseOf(doc profileDoc) (settingsBase, bool) {
	if doc.Revision < 1 || strings.ToLower(doc.ProfileID) != j.st.ProfileID || validSettings(doc.Settings) != nil {
		return settingsBase{}, false
	}
	return settingsBase{Revision: doc.Revision, Settings: cloneSettings(doc.Settings)}, true
}

// upload sends the unacknowledged originals, exact bytes, in batches within the server's limits. The
// results must answer each batch event by event; an event is acknowledged only by a stored or identical
// result carrying its own hash. upload returns how many of the events it sent stay pending.
func (j *Journal) upload(ctx context.Context, a *api, rep *SyncReport) (int, error) {
	tried := make(map[int]bool)
	pending := 0
	for {
		batch, body := j.nextBatch(tried)
		if len(batch) == 0 {
			return pending, nil
		}
		status, resp, err := a.send(ctx, http.MethodPost, "/v1/profiles/"+j.st.ProfileID+"/events", "application/json", "", body)
		if err != nil {
			return pending, err
		}
		if status != http.StatusOK {
			return pending, refused("event upload", status, resp)
		}
		var doc struct {
			Results []resultDoc `json:"results"`
		}
		if json.Unmarshal(resp, &doc) != nil || len(doc.Results) != len(batch) {
			return pending, ErrBadResponse
		}
		for k, i := range batch {
			if r := doc.Results[k]; r.Index == nil || *r.Index != k || r.EventID != j.st.Originals[i].EventID {
				return pending, ErrBadResponse
			}
		}
		var acked []int
		for k, i := range batch {
			o, r := j.st.Originals[i], doc.Results[k]
			switch {
			case r.Result == "stored" && r.Status == http.StatusCreated && r.SemanticSHA256 == o.SemanticSHA256:
				rep.Stored++
				acked = append(acked, i)
			case r.Result == "identical" && r.Status == http.StatusOK && r.SemanticSHA256 == o.SemanticSHA256:
				rep.Identical++
				acked = append(acked, i)
			case r.Result == "conflict":
				rep.Conflicts = append(rep.Conflicts, o.EventID)
				pending++
			default:
				pending++
			}
		}
		if err := j.commit(func(st *fileState) error {
			for _, i := range acked {
				st.Originals[i].Acked = true
			}
			return nil
		}); err != nil {
			return pending, err
		}
	}
}

// nextBatch takes the next unacknowledged originals not yet tried in this sync, in record order and
// within the event upload limits, and writes the request with their exact bytes.
func (j *Journal) nextBatch(tried map[int]bool) ([]int, []byte) {
	var batch []int
	var body bytes.Buffer
	body.WriteString(`{"events":[`)
	for i, o := range j.st.Originals {
		if o.Acked || tried[i] {
			continue
		}
		if len(batch) == maxBatchEvents || (len(batch) > 0 && body.Len()+1+len(o.Envelope)+2 > maxBatchBytes) {
			break
		}
		if len(batch) > 0 {
			body.WriteByte(',')
		}
		body.Write(o.Envelope)
		batch = append(batch, i)
		tried[i] = true
	}
	body.WriteString("]}")
	return batch, body.Bytes()
}

// pull follows the device family's pages from the cursor. Each page is checked (family, app, increasing
// sequence numbers, next_after) and saved, the other devices' events with their exact payload bytes and
// the new cursor together, before the next page is asked for. The cursor follows next_after, never
// high_seq, which counts every family.
func (j *Journal) pull(ctx context.Context, a *api, rep *SyncReport) error {
	for {
		q := url.Values{"after": {strconv.FormatInt(j.st.Cursor, 10)}, "limit": {strconv.Itoa(pullLimit)}, "family": {j.st.Device.Family}}
		status, body, err := a.send(ctx, http.MethodGet, "/v1/profiles/"+j.st.ProfileID+"/events?"+q.Encode(), "", "", nil)
		if err != nil {
			return err
		}
		if status != http.StatusOK {
			return refused("pull", status, body)
		}
		var page pageDoc
		if json.Unmarshal(body, &page) != nil {
			return ErrBadResponse
		}
		fresh, next, ok := j.checkPage(page)
		if !ok {
			return ErrBadResponse
		}
		if err := j.commit(func(st *fileState) error {
			st.Remote = append(st.Remote, fresh...)
			st.Cursor = next
			return nil
		}); err != nil {
			return err
		}
		rep.Pulled += len(fresh)
		if !page.HasMore {
			return nil
		}
	}
}

// checkPage validates a page against the cursor and returns the events of other devices it adds, once
// each, and the page's next cursor. The device's own events stay only among its local originals.
func (j *Journal) checkPage(page pageDoc) ([]remoteRecord, int64, bool) {
	dev := j.st.Device
	seenSeq := make(map[int64]bool, len(j.st.Remote))
	seenID := make(map[remoteKey]bool, len(j.st.Remote))
	for _, r := range j.st.Remote {
		seenSeq[r.Seq] = true
		seenID[remoteKey{r.InstallID, r.LocalProfileID, r.EventID}] = true
	}
	last := j.st.Cursor
	var fresh []remoteRecord
	for _, e := range page.Events {
		if e.Seq <= last || e.EventID == "" || e.Kind != envelope.KindAnswer || e.Curriculum.Family != dev.Family ||
			e.Source.App != dev.App || len(e.Payload) == 0 || e.Payload[0] != '{' {
			return nil, 0, false
		}
		last = e.Seq
		key := remoteKey{e.Source.InstallID, e.Source.LocalProfileID, e.EventID}
		own := e.Source.InstallID == dev.InstallID && e.Source.LocalProfileID == dev.LocalProfileID
		if own || seenSeq[e.Seq] || seenID[key] {
			continue
		}
		seenSeq[e.Seq], seenID[key] = true, true
		fresh = append(fresh, remoteRecord{Seq: e.Seq, EventID: e.EventID, InstallID: e.Source.InstallID,
			LocalProfileID: e.Source.LocalProfileID, Payload: bytes.Clone(e.Payload)})
	}
	if page.NextAfter == nil || *page.NextAfter != last || (page.HasMore && len(page.Events) == 0) {
		return nil, 0, false
	}
	return fresh, last, true
}

// PushSettings sends the local settings that differ from the base, null for a removed one, as an RFC 7396
// patch conditional on the base revision; when nothing differs it sends nothing. On success the profile
// the server returns becomes the new base. A stale base fails with *SettingsConflict carrying the
// server's current revision and settings; the local settings and the base stay as they were, nothing is
// merged automatically, and RebaseSettings resolves the conflict.
func (j *Journal) PushSettings(ctx context.Context, c *Client) error {
	j.mu.Lock()
	defer j.mu.Unlock()
	if j.closed {
		return ErrClosed
	}
	if j.st.ProfileID == "" || j.st.Base == nil {
		return ErrNotLinked
	}
	patch := settingsPatch(j.st.Base.Settings, j.st.Settings)
	if len(patch) == 0 {
		return nil
	}
	a, err := newAPI(c)
	if err != nil {
		return err
	}
	body, err := json.Marshal(map[string]map[string]any{"settings": patch})
	if err != nil {
		return fmt.Errorf("journal: encode the settings patch: %w", err)
	}
	status, resp, err := a.send(ctx, http.MethodPatch, "/v1/profiles/"+j.st.ProfileID, "application/merge-patch+json", etag(j.st.Base.Revision), body)
	if err != nil {
		return err
	}
	switch status {
	case http.StatusOK:
		var doc profileDoc
		if json.Unmarshal(resp, &doc) != nil {
			return ErrBadResponse
		}
		base, ok := j.baseOf(doc)
		if !ok {
			return ErrBadResponse
		}
		return j.commit(func(st *fileState) error {
			st.Base = &base
			return nil
		})
	case http.StatusPreconditionFailed:
		var p struct {
			Current *profileDoc `json:"current"`
		}
		if json.Unmarshal(resp, &p) != nil || p.Current == nil {
			return ErrBadResponse
		}
		cur, ok := j.baseOf(*p.Current)
		if !ok {
			return ErrBadResponse
		}
		return &SettingsConflict{Revision: cur.Revision, Server: cur.Settings}
	default:
		return refused("settings push", status, resp)
	}
}

// settingsPatch lists the members whose local value differs from the base: the local value, or nil (JSON
// null) to remove the member.
func settingsPatch(base, local Settings) map[string]any {
	patch := map[string]any{}
	if !samePtr(base.InstructionLang, local.InstructionLang) {
		patch["instruction_lang"] = valueOrNil(local.InstructionLang)
	}
	if !samePtr(base.SessionMinutes, local.SessionMinutes) {
		patch["session_minutes"] = valueOrNil(local.SessionMinutes)
	}
	if !samePtr(base.ArabicScale, local.ArabicScale) {
		patch["arabic_scale"] = valueOrNil(local.ArabicScale)
	}
	return patch
}

func samePtr[T comparable](a, b *T) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && *a == *b)
}

// valueOrNil is a setting's JSON value: the value, or null to remove the member.
func valueOrNil[T any](p *T) any {
	if p == nil {
		return nil
	}
	return *p
}
