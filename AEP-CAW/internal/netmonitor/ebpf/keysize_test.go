package ebpf

import (
	"bytes"
	"encoding/binary"
	"testing"

	"github.com/cilium/ebpf"
)

// TestLPMKeys_PackedInBothObjects asserts that the LPM trie maps in the embedded BPF
// objects declare packed keys. The trie matches prefixlen bits of the bytes right
// after prefixlen, so alignment padding there would shift every prefix match, and the
// Go keys in maps_linux.go marshal packed through encoding/binary. lpm4 is
// prefixlen(4) cgroup_id(8) addr(4) dport(2) = 18 bytes and lpm6 is 4+8+16+2 = 30.
func TestLPMKeys_PackedInBothObjects(t *testing.T) {
	want := map[string]uint32{"lpm4_allow": 18, "lpm4_deny": 18, "lpm6_allow": 30, "lpm6_deny": 30}
	for name, obj := range map[string][]byte{"connect_bpfel.o": bpfObjBytes, "connect_bpfel_arm64.o": bpfObjBytesArm64} {
		spec, err := ebpf.LoadCollectionSpecFromReader(bytes.NewReader(obj))
		if err != nil {
			t.Fatalf("%s: load spec: %v", name, err)
		}
		for m, size := range want {
			ms, ok := spec.Maps[m]
			if !ok {
				t.Fatalf("%s: map %s missing", name, m)
			}
			if ms.KeySize != size {
				t.Errorf("%s: map %s key size = %d, want %d", name, m, ms.KeySize, size)
			}
		}
	}
}

// TestAllowKey_BinarySizeMatchesBPFMap asserts that AllowKey marshals to the
// same number of bytes as the kernel BPF map's declared key_size for
// `struct allow_key` in connect.bpf.c.
//
// The C struct compiles to 32 bytes because the trailing 16-byte addr is
// followed by an implicit pad up to __u64 alignment (the leading
// cgroup_id field). encoding/binary, used by cilium/ebpf for plain Go
// structs that do not implement BinaryMarshaler, emits no trailing
// padding - so without an explicit `_ [4]byte` tail, AllowKey marshals
// to 28 bytes and cilium/ebpf rejects every Put with
// "ebpf.AllowKey doesn't marshal to 32 bytes", silently disabling
// connect-filter enforcement at runtime.
//
// See issue #349.
func TestAllowKey_BinarySizeMatchesBPFMap(t *testing.T) {
	const wantBytes = 32
	got := binary.Size(AllowKey{})
	if got != wantBytes {
		t.Errorf("binary.Size(AllowKey{}) = %d, want %d (kernel BPF map declares key_size=32 due to __u64 alignment)", got, wantBytes)
	}
}
