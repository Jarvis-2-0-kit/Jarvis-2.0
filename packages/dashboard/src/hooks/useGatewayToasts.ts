import { useEffect, useRef } from 'react';
import { gateway } from '../gateway/client.js';
import { useToastStore } from '../store/toast-store.js';

/**
 * Hook that listens to gateway events and converts them into toast notifications.
 *
 * FIXED: Only shows toasts on actual STATUS CHANGES, not on every heartbeat.
 * Tracks previous agent states and only fires on transitions.
 */
export function useGatewayToasts() {
  const addToast = useToastStore((s) => s.addToast);
  const initialized = useRef(false);
  // Track previous agent states to only fire on CHANGES
  const agentStates = useRef(new Map<string, string>());

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const unsubs: Array<() => void> = [];

    // --- Connection events ---
    unsubs.push(
      gateway.on('_connected', () => {
        addToast({
          type: 'success',
          title: 'Connected',
          message: 'Gateway online',
          duration: 2000,
        });
      })
    );

    unsubs.push(
      gateway.on('_disconnected', () => {
        addToast({
          type: 'error',
          title: 'Disconnected',
          message: 'Lost connection. Reconnecting...',
          duration: 6000,
        });
      })
    );

    // --- Agent events — ONLY on status CHANGE ---
    unsubs.push(
      gateway.on('agent.status', (payload) => {
        const agent = payload as {
          identity: { agentId: string; role: string };
          status: string;
        };
        const agentId = agent.identity?.agentId || 'unknown';
        const newStatus = agent.status || 'unknown';
        const prevStatus = agentStates.current.get(agentId);

        // Update tracked state
        agentStates.current.set(agentId, newStatus);

        // Skip if status hasn't actually changed
        if (prevStatus === newStatus) return;

        // Skip idle->idle, online->idle etc (heartbeat noise)
        if (prevStatus && (prevStatus === 'idle' || prevStatus === 'online') && (newStatus === 'idle' || newStatus === 'online')) return;

        // Only show meaningful transitions
        if (!prevStatus) {
          // First time seeing this agent — show once
          addToast({
            type: 'agent',
            title: `${agentId.replace('agent-', '').toUpperCase()} Online`,
            message: `${agent.identity?.role || '?'} agent connected`,
            agentId,
            duration: 3000,
          });
        } else if (newStatus === 'busy' && prevStatus !== 'busy') {
          addToast({
            type: 'info',
            title: `${agentId.replace('agent-', '').toUpperCase()} Working`,
            message: 'Started processing task',
            agentId,
            duration: 3000,
          });
        } else if (newStatus === 'offline' || newStatus === 'disconnected') {
          addToast({
            type: 'warning',
            title: `${agentId.replace('agent-', '').toUpperCase()} Offline`,
            message: 'Agent went offline',
            agentId,
            duration: 5000,
          });
        } else if (prevStatus === 'busy' && (newStatus === 'idle' || newStatus === 'online')) {
          addToast({
            type: 'success',
            title: `${agentId.replace('agent-', '').toUpperCase()} Done`,
            message: 'Task completed, agent idle',
            agentId,
            duration: 3000,
          });
        }
      })
    );

    // --- Task events ---
    unsubs.push(
      gateway.on('task.created', (payload) => {
        const task = payload as { id: string; title?: string; description?: string };
        addToast({
          type: 'task',
          title: 'New Task',
          message: task.title || task.description || task.id,
          duration: 3000,
        });
      })
    );

    unsubs.push(
      gateway.on('task.completed', (payload) => {
        const task = payload as { taskId: string; agentId?: string };
        addToast({
          type: 'success',
          title: 'Task Done',
          message: `${task.taskId}${task.agentId ? ` by ${task.agentId.replace('agent-', '')}` : ''}`,
          agentId: task.agentId,
          duration: 3000,
        });
      })
    );

    // --- System health — only on FAILURES ---
    unsubs.push(
      gateway.on('system.health', (payload) => {
        const health = payload as {
          infrastructure?: { nats: boolean; redis: boolean; nas: { mounted: boolean } };
        };
        const infra = health.infrastructure;
        if (!infra) return;

        if (infra.nats === false) {
          addToast({ type: 'error', title: 'NATS Down', message: 'Message broker lost', duration: 8000 });
        }
        if (infra.redis === false) {
          addToast({ type: 'error', title: 'Redis Down', message: 'State store lost', duration: 8000 });
        }
        if (infra.nas && !infra.nas.mounted) {
          addToast({ type: 'warning', title: 'NAS Unmounted', message: 'Storage unavailable', duration: 8000 });
        }
      })
    );

    // --- Workflow events ---
    unsubs.push(
      gateway.on('workflow.completed', (payload) => {
        const wf = payload as { name?: string };
        addToast({ type: 'success', title: 'Workflow Done', message: wf.name || 'Completed', duration: 3000 });
      })
    );

    unsubs.push(
      gateway.on('workflow.failed', (payload) => {
        const wf = payload as { error?: string };
        addToast({ type: 'error', title: 'Workflow Failed', message: wf.error || 'Error', duration: 6000 });
      })
    );

    // NOTE: Removed chat.message toasts — too noisy. Chat has its own panel.
    // NOTE: Removed task.assigned, task.cancelled — too noisy for toasts.
    // NOTE: Removed workflow.started — only show completion/failure.

    return () => {
      unsubs.forEach((u) => u());
      initialized.current = false;
    };
  }, [addToast]);
}
