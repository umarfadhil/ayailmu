package envelope

import (
	"fmt"
	"slices"
	"strconv"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

// valueKind is the JSON type of a parsed value.
type valueKind uint8

const (
	kindNull valueKind = iota
	kindBool
	kindNumber
	kindString
	kindArray
	kindObject
)

// value is one parsed JSON value. raw is its exact source text. str is a string's unescaped text or
// a number's literal text: numbers are never converted, so no precision or spelling is lost.
type value struct {
	kind    valueKind
	raw     []byte
	str     string
	boolean bool
	elems   []*value
	members []member // in source order; names are unique
}

type member struct {
	key string
	val *value
}

// maxDepth bounds nesting so hostile input cannot exhaust the stack; client records nest about four
// levels deep.
const maxDepth = 64

// Canonicalize returns the aya-cjson-1 form of a JSON value: no insignificant whitespace, object
// members sorted by the UTF-8 bytes of their unescaped keys, strings re-escaped minimally, numbers
// kept as their literal text. Invalid UTF-8, lone surrogate escapes, duplicate keys and trailing
// data are rejected with a *Problem.
func Canonicalize(raw []byte) ([]byte, error) {
	v, prob := decode(raw)
	if prob != nil {
		return nil, prob
	}
	return appendCanonical(nil, v), nil
}

// appendCanonical appends the aya-cjson-1 form of v.
func appendCanonical(b []byte, v *value) []byte {
	switch v.kind {
	case kindNull:
		return append(b, "null"...)
	case kindBool:
		if v.boolean {
			return append(b, "true"...)
		}
		return append(b, "false"...)
	case kindNumber:
		return append(b, v.str...)
	case kindString:
		return appendString(b, v.str)
	case kindArray:
		b = append(b, '[')
		for i, e := range v.elems {
			if i > 0 {
				b = append(b, ',')
			}
			b = appendCanonical(b, e)
		}
		return append(b, ']')
	}
	members := slices.Clone(v.members)
	slices.SortFunc(members, func(x, y member) int { return strings.Compare(x.key, y.key) })
	b = append(b, '{')
	for i, m := range members {
		if i > 0 {
			b = append(b, ',')
		}
		b = appendString(b, m.key)
		b = append(b, ':')
		b = appendCanonical(b, m.val)
	}
	return append(b, '}')
}

// appendString writes s as a JSON string, escaping only '"', '\' and U+0000 to U+001F (as \b \f \n \r
// \t where JSON has a short form, otherwise \u00xx in lowercase hex). Everything else, DEL and U+2028
// included, is written as literal UTF-8.
func appendString(b []byte, s string) []byte {
	const hex = "0123456789abcdef"
	b = append(b, '"')
	start := 0
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 0x20 && c != '"' && c != '\\' {
			continue
		}
		b = append(b, s[start:i]...)
		switch c {
		case '"', '\\':
			b = append(b, '\\', c)
		case '\b':
			b = append(b, '\\', 'b')
		case '\f':
			b = append(b, '\\', 'f')
		case '\n':
			b = append(b, '\\', 'n')
		case '\r':
			b = append(b, '\\', 'r')
		case '\t':
			b = append(b, '\\', 't')
		default:
			b = append(b, '\\', 'u', '0', '0', hex[c>>4], hex[c&0xf])
		}
		start = i + 1
	}
	b = append(b, s[start:]...)
	return append(b, '"')
}

// decoder is a strict RFC 8259 parser that keeps each value's source span.
type decoder struct {
	in    []byte
	pos   int
	depth int
	err   string // first syntax error
	dupAt int    // offset of the first repeated member name, or -1
}

// decode parses one JSON text: RFC 8259 grammar, valid UTF-8, no unpaired surrogate escapes and
// nothing but whitespace after the value. A repeated member name (compared after unescaping) is
// reported only when the text is otherwise well formed, so malformed input is always invalid_json.
// Problem details give byte offsets, never content.
func decode(in []byte) (*value, *Problem) {
	d := &decoder{in: in, dupAt: -1}
	d.space()
	v := d.value()
	if v != nil {
		d.space()
		if d.pos < len(d.in) {
			d.fail("data after the JSON value")
		}
	}
	switch {
	case d.err != "":
		return nil, problem(CodeInvalidJSON, d.err)
	case d.dupAt >= 0:
		return nil, problem(CodeDuplicateKey, fmt.Sprintf("an object repeats a member name at byte %d", d.dupAt))
	}
	return v, nil
}

func (d *decoder) fail(msg string) {
	if d.err == "" {
		d.err = fmt.Sprintf("%s at byte %d", msg, d.pos)
	}
}

func (d *decoder) space() {
	for d.pos < len(d.in) {
		switch d.in[d.pos] {
		case ' ', '\t', '\n', '\r':
			d.pos++
		default:
			return
		}
	}
}

// next consumes c if it is the next byte.
func (d *decoder) next(c byte) bool {
	if d.pos < len(d.in) && d.in[d.pos] == c {
		d.pos++
		return true
	}
	return false
}

func (d *decoder) value() *value {
	if d.pos >= len(d.in) {
		d.fail("unexpected end of input")
		return nil
	}
	start := d.pos
	switch c := d.in[d.pos]; {
	case c == '{':
		return d.object()
	case c == '[':
		return d.array()
	case c == '"':
		s, ok := d.quoted()
		if !ok {
			return nil
		}
		return &value{kind: kindString, raw: d.in[start:d.pos], str: s}
	case c == '-' || (c >= '0' && c <= '9'):
		return d.number()
	case c == 't':
		return d.literal("true", kindBool, true)
	case c == 'f':
		return d.literal("false", kindBool, false)
	case c == 'n':
		return d.literal("null", kindNull, false)
	}
	d.fail("unexpected character")
	return nil
}

func (d *decoder) object() *value {
	start := d.pos
	if d.depth++; d.depth > maxDepth {
		d.fail("nesting too deep")
		return nil
	}
	defer func() { d.depth-- }()
	d.pos++ // '{'
	v := &value{kind: kindObject}
	d.space()
	if d.next('}') {
		v.raw = d.in[start:d.pos]
		return v
	}
	seen := make(map[string]bool)
	for {
		d.space()
		keyAt := d.pos
		if d.pos >= len(d.in) || d.in[d.pos] != '"' {
			d.fail("expected a member name")
			return nil
		}
		key, ok := d.quoted()
		if !ok {
			return nil
		}
		if seen[key] && d.dupAt < 0 {
			d.dupAt = keyAt
		}
		seen[key] = true
		d.space()
		if !d.next(':') {
			d.fail("expected ':'")
			return nil
		}
		d.space()
		val := d.value()
		if val == nil {
			return nil
		}
		v.members = append(v.members, member{key, val})
		d.space()
		if d.next(',') {
			continue
		}
		if d.next('}') {
			v.raw = d.in[start:d.pos]
			return v
		}
		d.fail("expected ',' or '}'")
		return nil
	}
}

func (d *decoder) array() *value {
	start := d.pos
	if d.depth++; d.depth > maxDepth {
		d.fail("nesting too deep")
		return nil
	}
	defer func() { d.depth-- }()
	d.pos++ // '['
	v := &value{kind: kindArray}
	d.space()
	if d.next(']') {
		v.raw = d.in[start:d.pos]
		return v
	}
	for {
		d.space()
		e := d.value()
		if e == nil {
			return nil
		}
		v.elems = append(v.elems, e)
		d.space()
		if d.next(',') {
			continue
		}
		if d.next(']') {
			v.raw = d.in[start:d.pos]
			return v
		}
		d.fail("expected ',' or ']'")
		return nil
	}
}

// quoted reads a string at its opening quote and returns the unescaped text. Raw control characters,
// invalid UTF-8, unknown escapes and unpaired surrogate escapes are syntax errors.
func (d *decoder) quoted() (string, bool) {
	d.pos++        // opening quote
	var buf []byte // used only once an escape appears
	start := d.pos
	for d.pos < len(d.in) {
		switch c := d.in[d.pos]; {
		case c == '"':
			var s string
			if buf == nil {
				s = string(d.in[start:d.pos])
			} else {
				s = string(append(buf, d.in[start:d.pos]...))
			}
			d.pos++
			return s, true
		case c == '\\':
			buf = append(buf, d.in[start:d.pos]...)
			r, ok := d.escape()
			if !ok {
				return "", false
			}
			buf = utf8.AppendRune(buf, r)
			start = d.pos
		case c < 0x20:
			d.fail("control character in a string")
			return "", false
		case c < utf8.RuneSelf:
			d.pos++
		default:
			r, size := utf8.DecodeRune(d.in[d.pos:])
			if r == utf8.RuneError && size == 1 {
				d.fail("invalid UTF-8 in a string")
				return "", false
			}
			d.pos += size
		}
	}
	d.fail("unterminated string")
	return "", false
}

// escape reads one escape sequence at its backslash and returns the rune it denotes. A high-surrogate
// \u escape must be followed by a low-surrogate \u escape.
func (d *decoder) escape() (rune, bool) {
	if d.pos+1 >= len(d.in) {
		d.fail("unterminated escape")
		return 0, false
	}
	c := d.in[d.pos+1]
	d.pos += 2
	switch c {
	case '"', '\\', '/':
		return rune(c), true
	case 'b':
		return '\b', true
	case 'f':
		return '\f', true
	case 'n':
		return '\n', true
	case 'r':
		return '\r', true
	case 't':
		return '\t', true
	case 'u':
	default:
		d.fail("invalid escape")
		return 0, false
	}
	r, ok := d.hex4()
	switch {
	case !ok:
		return 0, false
	case r >= 0xd800 && r <= 0xdbff:
		if d.pos+1 < len(d.in) && d.in[d.pos] == '\\' && d.in[d.pos+1] == 'u' {
			d.pos += 2
			lo, ok := d.hex4()
			if !ok {
				return 0, false
			}
			if lo >= 0xdc00 && lo <= 0xdfff {
				return utf16.DecodeRune(r, lo), true
			}
		}
		d.fail("unpaired surrogate escape")
		return 0, false
	case r >= 0xdc00 && r <= 0xdfff:
		d.fail("unpaired surrogate escape")
		return 0, false
	}
	return r, true
}

func (d *decoder) hex4() (rune, bool) {
	if d.pos+4 > len(d.in) {
		d.fail("short \\u escape")
		return 0, false
	}
	var r rune
	for _, c := range d.in[d.pos : d.pos+4] {
		switch {
		case c >= '0' && c <= '9':
			r = r<<4 | rune(c-'0')
		case c >= 'a' && c <= 'f':
			r = r<<4 | rune(c-'a'+10)
		case c >= 'A' && c <= 'F':
			r = r<<4 | rune(c-'A'+10)
		default:
			d.fail("invalid \\u escape")
			return 0, false
		}
	}
	d.pos += 4
	return r, true
}

// number reads -?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)? and keeps the literal text.
func (d *decoder) number() *value {
	start := d.pos
	d.next('-')
	if !d.next('0') && !d.digits() {
		d.fail("invalid number")
		return nil
	}
	if d.next('.') && !d.digits() {
		d.fail("invalid number")
		return nil
	}
	if d.next('e') || d.next('E') {
		if !d.next('+') {
			d.next('-')
		}
		if !d.digits() {
			d.fail("invalid number")
			return nil
		}
	}
	raw := d.in[start:d.pos]
	return &value{kind: kindNumber, raw: raw, str: string(raw)}
}

// digits consumes ASCII digits and reports whether there was at least one.
func (d *decoder) digits() bool {
	start := d.pos
	for d.pos < len(d.in) && d.in[d.pos] >= '0' && d.in[d.pos] <= '9' {
		d.pos++
	}
	return d.pos > start
}

func (d *decoder) literal(word string, kind valueKind, b bool) *value {
	if len(d.in)-d.pos < len(word) || string(d.in[d.pos:d.pos+len(word)]) != word {
		d.fail("invalid literal")
		return nil
	}
	start := d.pos
	d.pos += len(word)
	return &value{kind: kind, raw: d.in[start:d.pos], boolean: b}
}

// get returns object member key. Non-objects have no members.
func (v *value) get(key string) (*value, bool) {
	for _, m := range v.members {
		if m.key == key {
			return m.val, true
		}
	}
	return nil, false
}

// has reports whether member key is present, whatever its value (null included).
func (v *value) has(key string) bool {
	_, ok := v.get(key)
	return ok
}

func (v *value) stringMember(key string) (string, bool) {
	if m, ok := v.get(key); ok && m.kind == kindString {
		return m.str, true
	}
	return "", false
}

func (v *value) stringIn(key string, set map[string]bool) bool {
	s, ok := v.stringMember(key)
	return ok && set[s]
}

func (v *value) isEnum(set map[string]bool) bool {
	return v.kind == kindString && set[v.str]
}

func (v *value) isStringArray() bool {
	if v.kind != kindArray {
		return false
	}
	for _, e := range v.elems {
		if e.kind != kindString {
			return false
		}
	}
	return true
}

func (v *value) isEnumArray(set map[string]bool) bool {
	if v.kind != kindArray {
		return false
	}
	for _, e := range v.elems {
		if !e.isEnum(set) {
			return false
		}
	}
	return true
}

// isEnumObject reports whether v is an object whose every member value is in set.
func (v *value) isEnumObject(set map[string]bool) bool {
	if v.kind != kindObject {
		return false
	}
	for _, m := range v.members {
		if !m.val.isEnum(set) {
			return false
		}
	}
	return true
}

// isInt64 reports whether v is an integer literal (no fraction or exponent) that fits an int64.
func (v *value) isInt64() bool {
	if v.kind != kindNumber || strings.ContainsAny(v.str, ".eE") {
		return false
	}
	_, err := strconv.ParseInt(v.str, 10, 64)
	return err == nil
}

// optString returns member key when it is a string, else nil.
func (v *value) optString(key string) *string {
	if m, ok := v.get(key); ok && m.kind == kindString {
		s := m.str
		return &s
	}
	return nil
}

// optBool returns member key when it is a boolean, else nil.
func (v *value) optBool(key string) *bool {
	if m, ok := v.get(key); ok && m.kind == kindBool {
		b := m.boolean
		return &b
	}
	return nil
}

// stringList returns the strings of array member key.
func (v *value) stringList(key string) []string {
	m, ok := v.get(key)
	if !ok || m.kind != kindArray {
		return nil
	}
	out := make([]string, 0, len(m.elems))
	for _, e := range m.elems {
		if e.kind == kindString {
			out = append(out, e.str)
		}
	}
	return out
}
