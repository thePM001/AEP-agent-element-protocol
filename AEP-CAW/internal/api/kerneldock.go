package api

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/nla-aep/aep-caw-framework/internal/events"
	"github.com/nla-aep/aep-caw-framework/internal/kerneldock"
	"github.com/nla-aep/aep-caw-framework/pkg/types"
)

// kernelDockGate refuses the run when the Base Node kernel dock stays silent.
//
// The check sits in the execution path rather than in a separate operator
// script, so a wrapped command cannot start while the kernel that admits it is
// not answering. Every exec entry point calls it: the plain exec, the streamed
// exec and the PTY start. It returns the named kerneldock refusal, which the
// caller reports as the run refusal.
func (a *App) kernelDockGate(ctx context.Context, sessionID string, cmdID string) error {
	if a == nil || a.cfg == nil {
		return nil
	}
	kc := a.cfg.KernelDock
	if !kc.KernelDockEnabled() {
		return nil
	}
	err := kerneldock.Probe(kerneldock.Options{
		SocketBase: kc.SocketBase,
		Dock:       kc.Dock,
		Timeout:    kc.KernelDockTimeout(),
	})
	if err == nil {
		return nil
	}
	a.emitKernelDockRefusal(ctx, sessionID, cmdID, err)
	return err
}

// emitKernelDockRefusal records one refusal event, so the evidence names the
// rule, the silent dock and its socket path.
func (a *App) emitKernelDockRefusal(ctx context.Context, sessionID string, cmdID string, refusal error) {
	if a == nil || a.store == nil {
		return
	}
	fields := map[string]any{
		"rule":  kerneldock.Rule,
		"error": refusal.Error(),
	}
	var ref *kerneldock.Refusal
	if errors.As(refusal, &ref) {
		fields["dock"] = ref.Dock
		fields["socket"] = ref.Socket
	}
	ev := types.Event{
		ID:              uuid.NewString(),
		Timestamp:       time.Now().UTC(),
		Type:            string(events.EventKernelDockRefused),
		SessionID:       sessionID,
		CommandID:       cmdID,
		Source:          "aep-caw",
		EffectiveAction: "deny",
		Fields:          fields,
	}
	_ = a.store.AppendEvent(ctx, ev)
	if a.broker != nil {
		a.broker.Publish(ev)
	}
}
