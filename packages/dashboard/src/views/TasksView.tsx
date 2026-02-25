import { useState, useEffect } from 'react';
import { useGatewayStore } from '../store/gateway-store.js';
import { gateway } from '../gateway/client.js';
import {
  ListTodo,
  Plus,
  Play,
  XCircle,
  CheckCircle,
  Clock,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Send,
} from 'lucide-react';

interface TaskDef {
  id: string;
  title: string;
  description: string;
  priority: string;
  assignedAgent: string | null;
  status?: string;
  requiredCapabilities?: string[];
  createdAt?: number;
  updatedAt?: number;
}

export function TasksView() {
  const connected = useGatewayStore((s) => s.connected);
  const tasks = useGatewayStore((s) => s.tasks);
  const createTask = useGatewayStore((s) => s.createTask);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [filter, setFilter] = useState<string>('all');
  const [expandedTask, setExpandedTask] = useState<string | null>(null);

  // Create form state
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newPriority, setNewPriority] = useState('normal');
  const [newCapabilities, setNewCapabilities] = useState('code');

  const handleCreate = () => {
    if (!newTitle.trim()) return;
    createTask({
      title: newTitle,
      description: newDescription,
      priority: newPriority,
      assignedAgent: null,
      requiredCapabilities: newCapabilities.split(',').map(c => c.trim()).filter(Boolean),
    });
    setNewTitle('');
    setNewDescription('');
    setNewPriority('normal');
    setNewCapabilities('code');
    setShowCreateForm(false);
  };

  const handleCancel = async (taskId: string) => {
    try {
      await gateway.request('tasks.cancel', { taskId });
    } catch (err) {
      console.error('Cancel failed:', err);
    }
  };

  const filteredTasks = filter === 'all'
    ? tasks
    : filter === 'active'
      ? tasks.filter(t => !t.status || t.status === 'pending' || t.status === 'queued' || t.status === 'assigned' || t.status === 'in-progress')
      : tasks.filter(t => t.status === filter);

  const getStatusIcon = (status?: string) => {
    switch (status) {
      case 'completed': return <CheckCircle size={14} color="var(--green-bright)" />;
      case 'cancelled': return <XCircle size={14} color="var(--text-muted)" />;
      case 'failed': return <AlertTriangle size={14} color="var(--red-bright)" />;
      case 'running': return <Play size={14} color="var(--amber)" />;
      default: return <Clock size={14} color="var(--cyan-bright)" />;
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'critical': return 'var(--red-bright)';
      case 'high': return 'var(--amber)';
      case 'normal': return 'var(--cyan-bright)';
      case 'low': return 'var(--text-muted)';
      default: return 'var(--text-secondary)';
    }
  };

  return (
    <div style={{
      height: '100%',
      overflow: 'auto',
      padding: 20,
      background: 'var(--bg-primary)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <ListTodo size={20} color="var(--cyan-bright)" />
        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 16,
          letterSpacing: 3,
          color: 'var(--cyan-bright)',
          textShadow: 'var(--glow-cyan)',
          margin: 0,
        }}>
          TASK MANAGEMENT
        </h1>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          style={{
            marginLeft: 'auto',
            fontSize: 10,
            padding: '4px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            background: showCreateForm ? 'rgba(255,51,51,0.1)' : 'rgba(0,255,65,0.1)',
            borderColor: showCreateForm ? 'var(--red-dim)' : 'var(--green-dim)',
            color: showCreateForm ? 'var(--red-bright)' : 'var(--green-bright)',
          }}
        >
          {showCreateForm ? <XCircle size={12} /> : <Plus size={12} />}
          {showCreateForm ? 'CANCEL' : 'NEW TASK'}
        </button>
      </div>

      {/* Create Task Form */}
      {showCreateForm && (
        <div style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--green-dim)',
          borderRadius: 6,
          padding: 16,
          marginBottom: 16,
        }}>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: 11,
            letterSpacing: 2,
            color: 'var(--green-bright)',
            marginBottom: 12,
          }}>
            CREATE NEW TASK
          </div>

          <div style={{ display: 'grid', gap: 10 }}>
            <input
              type="text"
              placeholder="Task title..."
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              style={{ width: '100%' }}
            />

            <textarea
              placeholder="Task description..."
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              rows={3}
              style={{ width: '100%', resize: 'vertical' }}
            />

            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-display)', letterSpacing: 1 }}>
                  PRIORITY
                </label>
                <select
                  value={newPriority}
                  onChange={(e) => setNewPriority(e.target.value)}
                  style={{
                    width: '100%',
                    marginTop: 4,
                    padding: '6px 10px',
                    background: 'var(--bg-input)',
                    border: '1px solid var(--border-primary)',
                    color: 'var(--text-primary)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                    borderRadius: 4,
                  }}
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>

              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-display)', letterSpacing: 1 }}>
                  CAPABILITIES
                </label>
                <input
                  type="text"
                  placeholder="code, build, deploy..."
                  value={newCapabilities}
                  onChange={(e) => setNewCapabilities(e.target.value)}
                  style={{ width: '100%', marginTop: 4 }}
                />
              </div>
            </div>

            <button
              onClick={handleCreate}
              disabled={!newTitle.trim()}
              className="primary"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: '8px 16px',
                opacity: newTitle.trim() ? 1 : 0.5,
              }}
            >
              <Send size={12} />
              CREATE & ASSIGN
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {['all', 'active', 'completed', 'failed', 'cancelled'].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              fontSize: 9,
              padding: '3px 10px',
              background: filter === f ? 'rgba(0,255,255,0.1)' : 'transparent',
              border: `1px solid ${filter === f ? 'var(--cyan-dim)' : 'var(--border-dim)'}`,
              color: filter === f ? 'var(--cyan-bright)' : 'var(--text-muted)',
              fontFamily: 'var(--font-display)',
              letterSpacing: 1,
            }}
          >
            {f.toUpperCase()}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          {filteredTasks.length} task(s)
        </span>
      </div>

      {/* Tasks List */}
      <div style={{ display: 'grid', gap: 8 }}>
        {filteredTasks.length === 0 && (
          <div style={{
            padding: 30,
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
          }}>
            No tasks found. Create a new task to get started.
          </div>
        )}

        {filteredTasks.map((task) => (
          <div
            key={task.id}
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-primary)',
              borderRadius: 6,
              overflow: 'hidden',
            }}
          >
            {/* Task Header */}
            <div
              onClick={() => setExpandedTask(expandedTask === task.id ? null : task.id)}
              style={{
                padding: '10px 14px',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                cursor: 'pointer',
              }}
            >
              {getStatusIcon(task.status)}

              <span style={{
                flex: 1,
                fontSize: 12,
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-white)',
              }}>
                {task.title}
              </span>

              <span style={{
                fontSize: 9,
                padding: '1px 6px',
                borderRadius: 3,
                border: `1px solid ${getPriorityColor(task.priority)}33`,
                color: getPriorityColor(task.priority),
                fontFamily: 'var(--font-display)',
                letterSpacing: 1,
              }}>
                {task.priority.toUpperCase()}
              </span>

              {task.assignedAgent && (
                <span style={{
                  fontSize: 9,
                  padding: '1px 6px',
                  borderRadius: 3,
                  background: 'rgba(0,255,255,0.05)',
                  border: '1px solid var(--border-cyan)',
                  color: 'var(--cyan-bright)',
                  fontFamily: 'var(--font-mono)',
                }}>
                  {task.assignedAgent}
                </span>
              )}

              {expandedTask === task.id ? (
                <ChevronUp size={14} color="var(--text-muted)" />
              ) : (
                <ChevronDown size={14} color="var(--text-muted)" />
              )}
            </div>

            {/* Task Detail (expanded) */}
            {expandedTask === task.id && (
              <div style={{
                padding: '10px 14px',
                borderTop: '1px solid var(--border-dim)',
                fontSize: 12,
                fontFamily: 'var(--font-mono)',
              }}>
                {task.description && (
                  <div style={{
                    color: 'var(--text-secondary)',
                    marginBottom: 10,
                    whiteSpace: 'pre-wrap',
                  }}>
                    {task.description}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8 }}>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>ID: {task.id}</span>
                  {task.status !== 'completed' && task.status !== 'cancelled' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleCancel(task.id);
                      }}
                      className="danger"
                      style={{ marginLeft: 'auto', fontSize: 9, padding: '2px 8px' }}
                    >
                      CANCEL
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
