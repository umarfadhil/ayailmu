package native

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"reflect"
	"strings"
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
	if err := exactFields(b, reflect.TypeOf(target)); err != nil {
		return err
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

// encoding/json accepts case-insensitive struct aliases. Native Kotlin contracts do
// not: reject every noncanonical field before decoding, including nested responses.
// Map keys (for example auto_score part names) retain their ordinary semantics.
func exactFields(b []byte, typ reflect.Type) error {
	if typ == nil || typ.Kind() != reflect.Pointer {
		return fmt.Errorf("missing JSON target")
	}
	return exactValue(b, typ.Elem(), false)
}
func exactValue(b []byte, typ reflect.Type, nullable bool) error {
	for typ.Kind() == reflect.Pointer {
		nullable = true
		typ = typ.Elem()
	}
	if bytes.Equal(bytes.TrimSpace(b), []byte("null")) {
		if nullable {
			return nil
		}
		return fmt.Errorf("null for nonnullable JSON field")
	}
	switch typ.Kind() {
	case reflect.Struct:
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(b, &fields); err != nil {
			return err
		}
		type property struct {
			typ      reflect.Type
			nullable bool
		}
		known := make(map[string]property, typ.NumField())
		for i := 0; i < typ.NumField(); i++ {
			f := typ.Field(i)
			if f.PkgPath != "" {
				continue
			}
			name := strings.Split(f.Tag.Get("json"), ",")[0]
			if name == "-" {
				continue
			}
			if name == "" {
				name = f.Name
			}
			known[name] = property{f.Type, f.Tag.Get("jsonnull") == "true"}
		}
		for name, raw := range fields {
			field, ok := known[name]
			if !ok {
				return fmt.Errorf("unknown JSON field")
			}
			if err := exactValue(raw, field.typ, field.nullable); err != nil {
				return err
			}
		}
	case reflect.Slice, reflect.Array:
		var values []json.RawMessage
		if err := json.Unmarshal(b, &values); err != nil {
			return err
		}
		for _, raw := range values {
			if err := exactValue(raw, typ.Elem(), false); err != nil {
				return err
			}
		}
	case reflect.Map:
		var values map[string]json.RawMessage
		if err := json.Unmarshal(b, &values); err != nil {
			return err
		}
		for _, raw := range values {
			if err := exactValue(raw, typ.Elem(), false); err != nil {
				return err
			}
		}
	}
	return nil
}
