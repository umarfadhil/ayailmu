package labconfig

import (
	"testing"
	"time"
)

func TestRouterLimits(t *testing.T) {
	for _, address := range []string{"127.0.0.1:8188", "[::1]:8188"} {
		if err := RouterLimits(address, 30*time.Minute); err != nil {
			t.Fatal(err)
		}
	}
	for _, address := range []string{"0.0.0.0:8188", ":8188", "[::]:8188", "localhost:8188", "127.0.0.1:0", "127.0.0.1:65536"} {
		if err := RouterLimits(address, time.Minute); err == nil {
			t.Errorf("unsafe listen accepted: %s", address)
		}
	}
	for _, duration := range []time.Duration{0, -time.Second, time.Millisecond, 31 * time.Minute} {
		if err := RouterLimits("127.0.0.1:8188", duration); err == nil {
			t.Errorf("unbounded/invalid lifetime accepted: %s", duration)
		}
	}
}
