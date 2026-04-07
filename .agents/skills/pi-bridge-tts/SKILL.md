---
name: pi-bridge-tts
description: Guidelines for generating voice messages via pi-bridge with xAI TTS and automatic speech tag optimization
---

# pi-bridge TTS with xAI Speech Tags

Guidelines for generating voice messages via pi-bridge with xAI TTS.

## Core Principle

**You write clean, natural text. The system automatically optimizes it for voice output.**

- **Text output:** Displayed exactly as written
- **Voice output:** Automatically enhanced with speech tags (pauses, emotions, emphasis)

You do **not** need to add speech tags manually. Write naturally, the system handles the rest.

---

## Writing Effective Text for Voice

Based on xAI's best practices for high-quality TTS output:

### 1. Use Natural Punctuation

Commas, periods, and question marks guide pacing and intonation. The system uses punctuation to add natural pauses.

**Good:**
```
"Wait, really? That's amazing!"
```
→ System adds: `[pause]` after "really?", `[laugh]` after "amazing!"

**Bad:**
```
"Wait really thats amazing"
```
→ Flat delivery, no natural rhythm

### 2. Add Emotional Context

Exclamation marks and question marks influence delivery. They help the system detect the right emotional tone.

| Punctuation | System Response |
|-------------|-----------------|
| `"That's amazing!"` | Adds `[laugh]` - enthusiastic |
| `"That's amazing."` | Matter-of-fact, neutral |
| `"Really?"` | Rising intonation, curious |
| `"Really."` | Flat, statement |

### 3. Keep Voice Messages Short (Critical!)

**xAI Limit:** 15,000 characters per request  
**Practical Limit:** 30-60 seconds of audio (about 75-150 words)

**System Validations:**
The system automatically checks voice messages and warns about:
- **Tables** (`| column | column |`) - Not suitable for voice
- **Long numbered lists** (>3 items) - Boring to listen to
- **Long bullet lists** (>3 items) - Don't work well in voice
- **Text too long** (>90s) - Recommend sending as text instead
- **Too many sentences** (>5) - Voice should be 3 sentences max

**Why short matters:**
- Voice messages can't be skimmed like text
- Long audio is exhausting to listen to
- Hard to scroll/seek in most chat apps
- 60+ seconds = high drop-off rate

**Structure for voice (3-part rule):**
1. **Core message** (what's important?)
2. **Context** (why does it matter?)  
3. **Call-to-action** (what should happen?)

**Example:**
```
"The deal is closed! We signed the contract. Details are in your notes."
→ Perfect: 3 sentences, ~8-10 seconds
```

### 4. Break Long Content into Paragraphs

Paragraph breaks create natural pauses. For voice, each paragraph becomes a segment with a pause.

**For voice:**
```
"Great news first: We hit our target. [pause]

The team did an outstanding job this quarter. [pause]

Check the dashboard for the full breakdown."
```

**For text (if longer):**
Use proper formatting with headers, bullet points, etc.

### 5. Rewriting Content for Voice (Learn This!)

When you have complex content that needs to be delivered as voice, **rewrite it** - don't just read it. Here's how:

#### Transforming Tables → Voice Summary

**Original (table - don't read this):**
```
| Product | Q1 Sales | Q2 Sales | Growth |
|---------|----------|----------|--------|
| Alpha   | €50K     | €75K     | +50%   |
| Beta    | €30K     | €45K     | +50%   |
| Gamma   | €20K     | €35K     | +75%   |
```

**Rewrite for voice (3 sentences):**
```
"Strong quarter! All products grew 50% or more. [pause] 
Alpha still leads at 75K. [pause] 
The full breakdown is in your spreadsheet."
```
→ Only the insight, not the raw data

#### Transforming Long Lists → Top 3

**Original (7 items - too many):**
```
Here's your todo list:
1. Review the contract
2. Call the client
3. Update the presentation
4. Check the budget
5. Email the team
6. Schedule the meeting
7. Prepare the report
```

**Rewrite for voice (group & prioritize):**
```
"Two priorities today: First, review the contract and call the client. 
[pause] Second, update the presentation. [pause] 
The rest is in your task list - tackle them after lunch."
```
→ Groups into 2 buckets, defers the rest

#### Transforming Long Text → 3-Sentence Summary

**Original (text you might write for text output):**
```
The project has been going very well. We completed phase 1 ahead of schedule. 
The team is working efficiently. We resolved the API integration issues. 
Client feedback has been positive. We're ready to move to phase 2 next week. 
Budget is on track. No blockers identified.
```

**Rewrite for voice (extract essence):**
```
"Project is ahead of schedule and under budget. [pause] 
API issues are fixed, client is happy. [pause] 
We're starting phase 2 next week - you're all set."
```
→ 8 sentences → 3 sentences, same information density

#### The Voice Rewrite Formula

**When converting any content to voice:**

1. **Extract the headline** - What's the one thing they must know?
2. **Add one supporting detail** - Proof or context
3. **Give a next step** - Action or where to find more info

**Before → After Examples:**

| Content Type | Before (for text) | After (for voice) |
|--------------|-------------------|-------------------|
| Status update | "Completed 5 tasks, 3 pending, 2 blocked" | "On track! 5 done, only 2 need help. Details in your board." |
| Meeting summary | "Discussed pricing, timeline, and resources" | "Pricing agreed, timeline works. Resource plan in your email." |
| Research result | "Found 12 papers, 3 relevant, 1 breakthrough" | "Found a breakthrough paper! Summary attached, read when you can." |
| Reminder | "Don't forget: meeting at 3pm, bring laptop, prepare slides, invite sent" | "3pm meeting - laptop ready? Slides are prepped and sent." |

**Remember: Voice is not a format, it's a conversation.**

---

### 6. Speech Tags: Automatic, Not Manual

The system adds tags based on your text analysis. You write naturally:

**You write:**
```
"We did it! The project is live."
```

**System produces:**
```
"We did it! [laugh] [pause] The project is live."
```

**Automatic insertions:**
| Trigger | Added | Example |
|---------|-------|---------|
| `!` after positive word | `[laugh]` | "Great! [laugh]" |
| `lol`, `haha`, `😂` | `[chuckle]` | "lol [chuckle]" |
| `?` with curiosity | `[pause]` + rising tone | "Really? [pause]" |
| `secret`, `password` | `<whisper>` | "<whisper>The code is...</whisper>" |
| `sigh`, `unfortunate` | `[sigh]` | "Too bad [sigh]" |
| Multiple sentences | `[pause]` between | "Done. [pause] Next..." |

---

## When to Use Voice vs. Text

### Use Voice When:
- Short emotional message (max 3 sentences)
- Personal touch is important
- Simple information (1-2 facts)
- Faster than typing
- Celebrations, encouragement, quick updates

**Examples:**
- "Deal is done! 🎉"
- "Good morning! Ready for today?"
- "That was fantastic work!"
- "Don't forget your medication"
- "Running 5 minutes late"

### Use Text When:
- More than 3 sentences needed
- Tables, numbers, data
- Step-by-step instructions
- Links or technical details
- Reference material (read again later)
- Complex explanations

**Examples:**
- Project timelines with dates
- Budget breakdowns
- Code snippets
- Research summaries
- Meeting notes with action items

---

## Voice Selection Guide

### Ara (Warm & Friendly) — Default
- **Tone:** Balanced, conversational, approachable
- **Best for:** Daily check-ins, support, personal conversations
- **Examples:** 
  - "Hey, how's your day going?"
  - "I've organized your notes for you"
  - "You did great on that presentation"

### Eve (Energetic & Upbeat)
- **Tone:** Engaging, enthusiastic, positive
- **Best for:** Good news, announcements, motivation
- **Examples:**
  - "We won the pitch! This is incredible!"
  - "Happy Monday! Let's crush those goals!"
  - "You're on fire today! 🔥"

### Rex (Confident & Clear)
- **Tone:** Professional, articulate, business-focused
- **Best for:** Updates, reports, tutorials, professional contexts
- **Examples:**
  - "The report is complete and delivered on time"
  - "Q3 targets have been exceeded by 12%"
  - "Here's how the new process works..."

### Leo (Authoritative & Strong)
- **Tone:** Commanding, decisive, instructional
- **Best for:** Leadership, important decisions, firm guidance
- **Examples:**
  - "We're proceeding with the acquisition"
  - "This is the final deadline"
  - "Team, focus on priority one"

### Sal (Smooth & Balanced)
- **Tone:** Versatile, neutral, adaptable
- **Best for:** When unsure which voice fits, general purpose
- **Examples:**
  - Neutral updates
  - Mixed professional/casual contexts

---

## Language Configuration

### Auto-Detection (`"language": "auto"`)
xAI automatically detects the language from text. Good for:
- Mixed-language conversations
- When language switches frequently
- Convenience

### Explicit Language Codes
For consistent results, specify the language:

| Language | Code |
|----------|------|
| English | `en` |
| German | `de` |
| French | `fr` |
| Spanish | `es-ES` / `es-MX` |
| Italian | `it` |
| Portuguese | `pt-BR` / `pt-PT` |
| Japanese | `ja` |
| Chinese | `zh` |
| ... | See xAI docs for full list |

**Recommendation:** Use `"auto"` for mixed content, explicit codes for consistent mono-lingual output.

---

## Technical Reference: Speech Tags

For reference only — you don't write these, the system adds them based on text analysis.

### Inline Tags (placed at specific points)

| Category | Tags |
|----------|------|
| **Pauses** | `[pause]`, `[long-pause]` |
| **Laughter & crying** | `[laugh]`, `[chuckle]`, `[giggle]`, `[cry]` |
| **Mouth sounds** | `[tsk]`, `[tongue-click]`, `[lip-smack]` |
| **Breathing** | `[breath]`, `[inhale]`, `[exhale]`, `[sigh]` |
| **Vocal effects** | `[hum-tune]` |

**Examples:**
```
"So I walked in and [pause] there it was. [laugh] I couldn't believe it!"

"I need to tell you something. [inhale] It's a secret. [exhale]"

"Tja, what can I say? [sigh] That's how it goes."

"[tsk] That was close."
```

### Wrapping Tags (wrap text sections)

| Category | Tags |
|----------|------|
| **Volume & intensity** | `<soft>`, `<loud>`, `<build-intensity>`, `<decrease-intensity>` |
| **Pitch & speed** | `<higher-pitch>`, `<lower-pitch>`, `<slow>`, `<fast>` |
| **Vocal style** | `<whisper>`, `<sing-song>`, `<singing>`, `<laugh-speak>`, `<emphasis>` |

**Examples:**
```
"I need to tell you something. <whisper>It is a secret.</whisper> Pretty cool, right?"

"That is <emphasis>really</emphasis> important!"

"<slow><soft>Goodnight, sleep well.</soft></slow>"

"<laugh-speak>Of course I'll do that!</laugh-speak>"

"<build-intensity>We are almost there!</build-intensity>"

"<fast>Quick, before they notice!</fast>"
```

### Complete Tag List (Alphabetical)

**Inline Tags:**
```
[breath]      [chuckle]      [cry]          [exhale]
[giggle]      [hum-tune]     [inhale]       [laugh]
[lip-smack]   [long-pause]   [pause]        [sigh]
[tsk]         [tongue-click]
```

**Wrapping Tags:**
```
<build-intensity>   <decrease-intensity>   <emphasis>
<fast>              <higher-pitch>         <laugh-speak>
<lower-pitch>       <loud>                 <singing>
<sing-song>         <slow>                 <soft>
<whisper>
```

### Best Practices for Tags (handled automatically)

From xAI documentation:

1. **Place inline tags where expression naturally occurs** — Don't force them, let them flow with the text
2. **Combine with punctuation** — `"Really? [laugh] That's incredible!"` produces more natural results than stacking tags
3. **Use `[pause]` or `[long-pause]` for dramatic timing** — Let a thought land before continuing
4. **Wrapping tags work best around complete phrases** — `<whisper>It is a secret.</whisper>` reads more naturally than wrapping individual words
5. **Combine styles for effect** — `<slow><soft>Goodnight, sleep well.</soft></slow>`

---

## Configuration Example

```json
{
  "pi-bridge": {
    "adapters": {
      "telegram": {
        "tts": {
          "enabled": true,
          "provider": "xai",
          "apiKey": "env:XAI_API_KEY",
          "voice": "ara",
          "language": "auto",
          "speed": 1.0
        }
      }
    },
    "bridge": {
      "voiceMode": {
        "enabled": true,
        "autoSwitch": true
      }
    }
  }
}
```

**Settings explained:**
- `enabled: true` — TTS active
- `provider: "xai"` — Use xAI TTS API
- `voice: "ara"` — Default voice (warm & friendly)
- `language: "auto"` — Auto-detect language
- `autoSwitch: true` — Voice in → Voice out, Text in → Text out

---

## Quick Reference Card

| | Voice Message | Text Message |
|---|---------------|--------------|
| **Length** | Max 3 sentences | Any length |
| **Structure** | Core → Context → CTA | Any structure |
| **Data** | No tables/lists | Tables OK |
| **Tags** | Auto-added | Not applicable |
| **Punctuation** | Critical for pacing | Standard use |
| **Best for** | Emotion, speed, presence | Detail, reference |

---

## Summary for Agents

1. **Write clean, natural text** — No special formatting needed
2. **Use punctuation** — It drives the voice pacing and emotion
3. **Keep voice messages short** — Max 3 sentences, 30-60 seconds
4. **No complex data in voice** — Tables, lists, numbers → text only
5. **Let the system optimize** — Automatic speech tag insertion

**Golden Rule:** If you read your message and think "This feels long," send it as text.
