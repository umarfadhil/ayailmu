package native

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
)

// Decode rejects duplicate object keys at every depth, trailing values and unknown fields.
func Decode(b []byte, target any) error {
	d := json.NewDecoder(bytes.NewReader(b))
	d.UseNumber()
	if err := walk(d, 0); err != nil {
		return err
	}
	if _, err := d.Token(); err != io.EOF {
		return fmt.Errorf("trailing JSON")
	}
	d = json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	return d.Decode(target)
}
func walk(d *json.Decoder, depth int) error {
	if depth > 24 {
		return fmt.Errorf("JSON too deep")
	}
	token, err := d.Token()
	if err != nil {
		return err
	}
	switch token {
	case json.Delim('{'):
		keys := map[string]bool{}
		for d.More() {
			k, err := d.Token()
			if err != nil {
				return err
			}
			key, ok := k.(string)
			if !ok || keys[key] {
				return fmt.Errorf("duplicate/invalid JSON key")
			}
			keys[key] = true
			if err = walk(d, depth+1); err != nil {
				return err
			}
		}
		end, err := d.Token()
		if err != nil || end != json.Delim('}') {
			return fmt.Errorf("invalid object")
		}
	case json.Delim('['):
		for d.More() {
			if err := walk(d, depth+1); err != nil {
				return err
			}
		}
		end, err := d.Token()
		if err != nil || end != json.Delim(']') {
			return fmt.Errorf("invalid array")
		}
	}
	return nil
}
