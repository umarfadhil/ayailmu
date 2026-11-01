//go:build darwin || linux

package generalingress

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"syscall"
	"time"
)

// FileJournal has no default path and never initializes a ledger automatically.
// Current callers/tests use only synthetic t.TempDir storage. It cannot send mail.
type FileJournal struct{ dir string }

func NewFileJournal(dir string) (*FileJournal, error) {
	if !filepath.IsAbs(dir) {
		return nil, ErrStorage
	}
	if err := os.Mkdir(dir, 0700); err != nil && !errors.Is(err, os.ErrExist) {
		return nil, ErrStorage
	}
	s, err := os.Lstat(dir)
	if err != nil || !s.IsDir() || s.Mode().Perm() != 0700 || s.Sys().(*syscall.Stat_t).Uid != uint32(os.Getuid()) {
		return nil, ErrStorage
	}
	real, err := filepath.EvalSymlinks(dir)
	if err != nil {
		return nil, ErrStorage
	}
	return &FileJournal{dir: real}, nil
}
func privateFile(f *os.File) error {
	s, e := f.Stat()
	if e != nil || !s.Mode().IsRegular() || s.Mode().Perm() != 0600 {
		return ErrStorage
	}
	st, ok := s.Sys().(*syscall.Stat_t)
	if !ok || st.Uid != uint32(os.Getuid()) || st.Nlink != 1 {
		return ErrStorage
	}
	return nil
}
func (d *FileJournal) open(name string, flags int) (*os.File, error) {
	fd, e := syscall.Open(filepath.Join(d.dir, name), flags|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0600)
	if e != nil {
		return nil, e
	}
	f := os.NewFile(uintptr(fd), name)
	if privateFile(f) != nil {
		f.Close()
		return nil, ErrStorage
	}
	return f, nil
}
func (d *FileJournal) syncDir() error {
	f, e := os.Open(d.dir)
	if e != nil {
		return e
	}
	defer f.Close()
	return f.Sync()
}
func (d *FileJournal) locked(ctx context.Context, fn func() error) error {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	f, e := d.open(".lock", syscall.O_RDWR|syscall.O_CREAT)
	if e != nil {
		return ErrStorage
	}
	defer f.Close()
	for {
		e = syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
		if e == nil {
			break
		}
		if e != syscall.EWOULDBLOCK && e != syscall.EAGAIN {
			return ErrStorage
		}
		select {
		case <-ctx.Done():
			return ErrStorage
		case <-time.After(5 * time.Millisecond):
		}
	}
	defer syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
	if ctx.Err() != nil {
		return ErrStorage
	}
	return fn()
}
func (d *FileJournal) marker() error {
	f, e := d.open(".initialized", syscall.O_RDONLY)
	if e != nil {
		return ErrStorage
	}
	defer f.Close()
	b, e := io.ReadAll(io.LimitReader(f, 16))
	if e != nil || string(b) != "budget-v1\n" {
		return ErrStorage
	}
	return nil
}
func (d *FileJournal) initialize(raw []byte) error {
	f, e := d.open(".initialized", syscall.O_WRONLY|syscall.O_CREAT|syscall.O_EXCL)
	if e != nil {
		return ErrStorage
	}
	_, e = f.WriteString("budget-v1\n")
	if e == nil {
		e = f.Sync()
	}
	closeErr := f.Close()
	if e != nil || closeErr != nil || d.syncDir() != nil {
		return ErrStorage
	}
	// A crash from here leaves the marker and forbids automatic reset/re-init.
	return d.commit(raw)
}
func (d *FileJournal) read() ([]byte, error) {
	if d.marker() != nil {
		return nil, ErrStorage
	}
	f, e := d.open("state.json", syscall.O_RDONLY)
	if e != nil {
		return nil, ErrStorage
	}
	defer f.Close()
	b, e := io.ReadAll(io.LimitReader(f, 2*1024*1024+1))
	if e != nil || len(b) > 2*1024*1024 {
		return nil, ErrStorage
	}
	return b, nil
}
func (d *FileJournal) commit(raw []byte) error {
	if d.marker() != nil || len(raw) > 2*1024*1024 {
		return ErrStorage
	}
	if s, e := os.Lstat(filepath.Join(d.dir, "state.json")); e == nil {
		if s.Mode()&os.ModeSymlink != 0 {
			return ErrStorage
		}
		f, e := d.open("state.json", syscall.O_RDONLY)
		if e != nil {
			return ErrStorage
		}
		f.Close()
	} else if !errors.Is(e, os.ErrNotExist) {
		return ErrStorage
	}
	f, e := os.CreateTemp(d.dir, ".pending-")
	if e != nil {
		return ErrStorage
	}
	name := f.Name()
	defer os.Remove(name)
	if e = privateFile(f); e == nil {
		_, e = f.Write(raw)
	}
	if e == nil {
		e = f.Sync()
	}
	closeErr := f.Close()
	if e != nil || closeErr != nil {
		return ErrStorage
	}
	if os.Rename(name, filepath.Join(d.dir, "state.json")) != nil {
		return ErrStorage
	}
	if d.syncDir() != nil {
		return ErrStorage
	}
	return nil
}
