package journal

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// fileFormat versions the journal file.
const fileFormat = 1

// fileState is the journal file: JSON, always written whole. Byte fields are base64, so envelopes,
// payloads and the frozen import request keep every byte.
type fileState struct {
	Format    int            `json:"format"`
	Device    Device         `json:"device"`
	Originals []original     `json:"originals"`
	ImportID  string         `json:"import_id,omitempty"`
	Frozen    *frozenImport  `json:"frozen_import,omitempty"`
	ProfileID string         `json:"profile_id,omitempty"`
	Base      *settingsBase  `json:"base,omitempty"`
	Cursor    int64          `json:"cursor"`
	Remote    []remoteRecord `json:"remote"`
	Settings  Settings       `json:"settings"`
	Consent   *Consent       `json:"consent,omitempty"`
	Session   []byte         `json:"session,omitempty"`
}

// original is one locally recorded envelope.
type original struct {
	EventID        string `json:"event_id"`
	SemanticSHA256 string `json:"semantic_sha256"`
	Envelope       []byte `json:"envelope"`
	Acked          bool   `json:"acked,omitempty"`
}

// frozenImport is the device's import request while it waits for a receipt that verifies.
type frozenImport struct {
	Body    []byte `json:"body"`    // the exact request, sent again on every retry
	Members []int  `json:"members"` // indexes of the originals it carries, in request order
	Target  string `json:"target"`  // the profile it links to; "" when it creates a profile
}

// settingsBase is the server's profile revision and settings as the device last learned them.
type settingsBase struct {
	Revision int64    `json:"revision"`
	Settings Settings `json:"settings"`
}

type remoteRecord struct {
	Seq            int64  `json:"seq"`
	EventID        string `json:"event_id"`
	InstallID      string `json:"install_id"`
	LocalProfileID string `json:"local_profile_id"`
	Payload        []byte `json:"payload"`
}

// consistent checks what the rest of the package relies on in a file it reads back.
func (st *fileState) consistent() bool {
	if st.Format != fileFormat || st.Cursor < 0 {
		return false
	}
	for _, o := range st.Originals {
		if o.EventID == "" || len(o.Envelope) == 0 || len(o.SemanticSHA256) != 64 {
			return false
		}
	}
	if f := st.Frozen; f != nil {
		if st.ImportID == "" || len(f.Body) == 0 || st.ProfileID != "" {
			return false
		}
		for _, i := range f.Members {
			if i < 0 || i >= len(st.Originals) || st.Originals[i].Acked {
				return false
			}
		}
	}
	return true
}

// commit applies change to a deep copy of the state and writes the copy durably; only then does the
// journal adopt it, so memory never runs ahead of the file.
func (j *Journal) commit(change func(st *fileState) error) error {
	data, err := json.Marshal(j.st)
	if err != nil {
		return fmt.Errorf("journal: encode state: %w", err)
	}
	var next fileState
	if err := json.Unmarshal(data, &next); err != nil {
		return fmt.Errorf("journal: copy state: %w", err)
	}
	if err := change(&next); err != nil {
		return err
	}
	if err := writeState(j.path, next); err != nil {
		return err
	}
	j.st = next
	return nil
}

// writeState writes the state to a new file next to path, syncs it and renames it over path, so a crash
// leaves either the old or the new journal. Only the owner may read the file.
func writeState(path string, st fileState) error {
	data, err := json.Marshal(st)
	if err != nil {
		return fmt.Errorf("journal: encode state: %w", err)
	}
	dir := filepath.Dir(path)
	f, err := os.CreateTemp(dir, filepath.Base(path)+".tmp-*")
	if err != nil {
		return fmt.Errorf("journal: write the journal file: %w", err)
	}
	tmp := f.Name()
	if err := writeSynced(f, data); err != nil {
		_ = f.Close()
		_ = os.Remove(tmp)
		return fmt.Errorf("journal: write the journal file: %w", err)
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("journal: write the journal file: %w", err)
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("journal: replace the journal file: %w", err)
	}
	syncDir(dir)
	return nil
}

func writeSynced(f *os.File, data []byte) error {
	if err := f.Chmod(0o600); err != nil {
		return err
	}
	if _, err := f.Write(data); err != nil {
		return err
	}
	return f.Sync()
}

// syncDir makes the rename durable where the platform allows it; a failure only weakens crash safety.
func syncDir(dir string) {
	if d, err := os.Open(dir); err == nil {
		_ = d.Sync()
		_ = d.Close()
	}
}
