# PRD: OpenCode Auto-Continue Plugin

## Overview

A minimal OpenCode plugin (~70 lines) that prompts the AI to continue work after 5 minutes of session idle time. Unlike todo-specific continuation, this provides general "continue if needed" nudges to prevent work sessions from stalling on any incomplete tasks.

## Problem Statement

OpenCode sessions often stall when:
- AI completes immediate tasks but misses follow-up work
- Users step away mid-session and lose momentum
- Context or next steps aren't obvious to the AI
- Sessions naturally pause between related tasks

This leads to incomplete work sessions where users must manually re-engage the AI to continue logical next steps.

## Solution

A lightweight plugin that:
1. Monitors for 5-minute idle periods
2. Injects a gentle "continue if needed" prompt
3. Allows AI to self-assess and continue relevant work
4. Includes smart throttling to prevent spam

## Core Functionality

### Must-Have Features

#### 1. Idle Detection & Auto-Prompt
- **Trigger**: Listen for `session.idle` events with 5+ minute idle time
- **Action**: Inject "continue if needed" prompt
- **Threshold**: 300,000ms (5 minutes) idle time
- **Implementation**: Use OpenCode's `event` plugin hook

#### 2. Gentle Continuation Prompt
- **Message**: "Please assess if there's any additional work needed and continue if appropriate"
- **Tone**: Suggestive, not demanding - allows AI to decline if work is complete
- **Context**: Include session directory for reference
- **Method**: Use `ctx.client.session.promptAsync()`

#### 3. Smart Throttling
- **Cooldown**: 10-minute minimum between continuation prompts
- **Session Tracking**: In-memory per-session last-prompt timestamps
- **Reset Logic**: Clear throttling on new user messages
- **Circuit Breaker**: Max 3 auto-continues per hour

#### 4. User Message Detection
- **Reset Trigger**: Any new user message resets the idle timer
- **Implementation**: Track last user message timestamp
- **Purpose**: Avoid prompting when user is actively working

## Technical Architecture

### Plugin Structure
```
auto-continue-plugin/
├── src/
│   ├── index.ts          # Plugin entry point (~20 lines)
│   ├── idle-handler.ts   # Core idle logic (~25 lines)
│   ├── throttle.ts       # Rate limiting (~15 lines)
│   └── types.ts         # Interfaces (~10 lines)
├── package.json
└── README.md
```

### Key APIs & Dependencies

#### OpenCode Plugin Interface
```typescript
export default function autoContinuePlugin(ctx: PluginContext): PluginInterface {
  return {
    config: () => ({ tools: [], agents: [] }),
    event: handleSessionEvent,
    'chat.message': handleUserMessage  // Reset idle tracking
  }
}
```

#### Critical OpenCode APIs
- `ctx.client.session.promptAsync()` - Inject continuation prompt
- `event.type === 'session.idle'` - Idle detection  
- `event.idleTime >= 300000` - 5-minute threshold
- `chat.message` hook - Detect user activity

#### Dependencies
- `@opencode-ai/plugin` - OpenCode plugin SDK only
- No external dependencies

### Core Logic Flow

```
session.idle event (5+ minutes)
    ↓
Check last continuation timestamp
    ↓
If >10min since last prompt:
    ↓
Check hourly continuation count (<3)
    ↓
Inject "continue if needed" prompt
    ↓
Update throttling timestamps
    ↓
Reset on next user message
```

### Data Structures

#### Session State (in-memory)
```typescript
interface SessionState {
  lastContinuation: number    // Timestamp of last auto-continue
  hourlyCount: number        // Continues in current hour  
  hourStart: number         // Start of current hour window
  lastUserMessage: number   // Last user activity timestamp
}

const sessionStates = new Map<string, SessionState>()
```

#### Configuration Constants
```typescript
const IDLE_THRESHOLD = 5 * 60 * 1000      // 5 minutes
const COOLDOWN_PERIOD = 10 * 60 * 1000    // 10 minutes  
const MAX_HOURLY_CONTINUES = 3            // Rate limit
const CONTINUE_PROMPT = "Please assess if there's any additional work needed and continue if appropriate."
```

## Success Metrics

### Functional Requirements
- ✅ Triggers after exactly 5 minutes of idle time
- ✅ Respects 10-minute cooldown between prompts
- ✅ Limits to 3 auto-continues per hour max
- ✅ Resets throttling on new user messages
- ✅ Works across different session types

### Performance Requirements
- ⚡ Plugin loads in <50ms
- ⚡ Event handling <10ms latency  
- ⚡ Memory usage <500KB total
- ⚡ Zero impact on active sessions

### User Experience Requirements
- 🎯 Non-intrusive - only acts during genuine idle periods
- 🎯 Respectful - AI can decline to continue if work is done
- 🎯 Predictable - consistent 5-minute timing
- 🎯 Self-regulating - throttling prevents spam

## Technical Implementation

### Plugin Entry Point
```typescript
export default function autoContinuePlugin(ctx: PluginContext): PluginInterface {
  return {
    config: () => ({ tools: [], agents: [] }),
    event: (event) => handleIdleEvent(event, ctx),
    'chat.message': (message, ctx) => handleUserActivity(message, ctx)
  }
}
```

### Core Event Handler
```typescript
async function handleIdleEvent(event: Event, ctx: PluginInput) {
  if (event.type !== 'session.idle' || event.idleTime < IDLE_THRESHOLD) return
  
  const state = getOrCreateSessionState(event.sessionId)
  const now = Date.now()
  
  // Check cooldown and rate limits
  if (now - state.lastContinuation < COOLDOWN_PERIOD) return
  if (state.hourlyCount >= MAX_HOURLY_CONTINUES && now - state.hourStart < 3600000) return
  
  // Inject continuation prompt
  await ctx.client.session.promptAsync({
    path: { id: event.sessionId },
    body: { parts: [{ type: 'text', text: CONTINUE_PROMPT }] },
    query: { directory: ctx.directory }
  })
  
  updateSessionState(event.sessionId, now)
}
```

## Configuration Options

### Built-in Constants (No Config UI Needed)
- **Idle Threshold**: 5 minutes (300,000ms)
- **Cooldown Period**: 10 minutes between prompts  
- **Hourly Limit**: 3 auto-continues maximum
- **Prompt Text**: Standard "continue if needed" message

### Future Configurability (Out of Scope)
- ❌ Adjustable idle timeouts
- ❌ Custom prompt templates
- ❌ Per-agent behavior differences
- ❌ User preference settings

## Risk Mitigation

### Technical Risks
- **Memory Leaks**: Session state cleanup on session end
- **Clock Drift**: Use relative timestamps, not absolute
- **API Failures**: Graceful error handling with logging
- **Race Conditions**: Simple in-memory state prevents conflicts

### User Experience Risks
- **Interruption**: 5-minute threshold ensures user isn't actively working
- **Spam Prevention**: 10-minute cooldown + 3/hour limit
- **Inappropriate Timing**: User message detection resets idle tracking
- **AI Confusion**: Clear, simple prompt allows AI to assess context

### Edge Cases
- **Session Restart**: In-memory state resets (acceptable)
- **Multiple Sessions**: Independent state tracking per session
- **Plugin Reload**: State resets without persistence (acceptable)
- **Long-running Sessions**: Hourly counter resets naturally

## Success Criteria

### Acceptance Tests
- [ ] Triggers after 5 minutes idle, not before
- [ ] Respects 10-minute cooldown between continues  
- [ ] Limits to 3 prompts per hour maximum
- [ ] Resets on any user message activity
- [ ] Handles session restart gracefully
- [ ] No memory leaks or performance impact

### User Validation
- [ ] Users report improved session continuity
- [ ] No complaints about interruption or spam
- [ ] AI provides meaningful continuations when appropriate
- [ ] Plugin feels "invisible" until needed

## Implementation Timeline

### Week 1: Core Implementation
- [ ] Plugin structure and OpenCode integration
- [ ] Basic idle detection (5-minute threshold)
- [ ] Simple prompt injection
- [ ] User message reset logic

### Week 2: Throttling & Polish  
- [ ] 10-minute cooldown implementation
- [ ] 3/hour rate limiting
- [ ] Error handling and logging
- [ ] Memory management and cleanup

### Week 3: Testing & Documentation
- [ ] Edge case testing (restarts, long sessions)
- [ ] Performance validation (<70 lines)
- [ ] README and installation guide
- [ ] Plugin registry submission

**Total Effort**: 3 weeks for production-ready plugin

This plugin provides gentle work continuity without the complexity of todo-specific logic, making it universally applicable to any OpenCode session that might benefit from periodic "nudges" to continue relevant work.