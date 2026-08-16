/**
 * Designer personas for the 3D "Chat with designers" room.
 *
 * Each persona is a designer who hangs out in the studio. The reply engine is
 * a tiny keyword matcher so the conversation feels alive without any backend.
 */

export interface Persona {
  id: string;
  name: string;
  role: string;
  /** Body colour */
  color: string;
  /** Hair / accent colour */
  accent: string;
  /** Skin tone */
  skin: string;
  /** Hair style: "bob" | "bun" | "flat" | "fro" | "beanie" */
  hair: string;
  /** Spoken when the player walks up */
  greetings: string[];
  /** Occasional chatter while the player is nearby */
  idle: string[];
  /** Keyword -> replies */
  replies: { keys: string[]; answers: string[] }[];
  /** Fallback when nothing matches */
  fallback: string[];
  /** Where they hang out in the room (x, z) */
  spawn: [number, number];
}

export const PERSONAS: Persona[] = [
  {
    id: "aarav",
    name: "Aarav",
    role: "Product Designer",
    color: "#2f6fed",
    accent: "#1c1c2e",
    skin: "#c98d5f",
    hair: "flat",
    spawn: [-6, -4],
    greetings: [
      "Hey! Welcome to the studio. I'm Aarav — product design.",
      "Oh hey! Grab a chair, I was just sketching a new flow.",
      "Hey, glad you came. Coffee's on the desk, literally.",
    ],
    idle: [
      "Have you tried the new auto-layout? Game changer.",
      "I've been tweaking this empty state for an hour.",
      "Good design is invisible. Bad design is a 12-step onboarding.",
      "I named my layers today. Baby steps.",
    ],
    replies: [
      {
        keys: ["hello", "hi ", "hi!", "hey", "yo", "namaste", "good morning", "good evening"],
        answers: [
          "Hey yourself! Nice to meet you.",
          "Hello hello! Welcome to the studio.",
        ],
      },
      {
        keys: ["figma"],
        answers: [
          "Figma's my daily driver. Auto-layout and components, every day.",
          "I could design in Figma with my eyes closed. Almost.",
        ],
      },
      {
        keys: ["color", "colour", "palette", "blue", "theme"],
        answers: [
          "I'm a sucker for a restrained palette. Two neutrals, one accent.",
          "Pick one hero colour. Everything else is a guest.",
        ],
      },
      {
        keys: ["font", "type", "typography", "text"],
        answers: [
          "Type is 80% of design. One hero face, keep it classy.",
          "Bad spacing kills great type. Give it room to breathe.",
        ],
      },
      {
        keys: ["ai", "gpt", "chatgpt", "copilot"],
        answers: [
          "AI tools are fun for exploring — but the taste is still yours.",
          "Let AI do the busywork, never the judgment.",
        ],
      },
      {
        keys: ["ux", "user", "research", "usability"],
        answers: [
          "If you're guessing, you're not researching. Talk to five users.",
          "The user is not you. Repeat after me.",
        ],
      },
      {
        keys: ["work", "job", "project", "ship", "shipping", "building"],
        answers: [
          "Just shipped a design system. Feels good.",
          "Working on the onboarding right now. It's 40% of my soul.",
        ],
      },
      {
        keys: ["who are you", "your name", "about you"],
        answers: [
          "I'm Aarav, product designer. I make flows people don't get lost in.",
        ],
      },
      {
        keys: ["joke", "funny", "lol", "haha"],
        answers: [
          "Why did the designer break up with Figma? Too many frames in the relationship.",
        ],
      },
      {
        keys: ["bye", "see you", "later", "goodbye", "gtg"],
        answers: ["See you around the studio! Don't forget to name your layers."],
      },
      {
        keys: ["thanks", "thank you", "ty", "great", "nice", "awesome", "cool"],
        answers: ["Anytime! Come back when you need a second pair of eyes."],
      },
    ],
    fallback: [
      "Interesting — tell me more while I fiddle with this prototype.",
      "Hmm, let me think about that. I'm between keystrokes anyway.",
      "Noted. I'll add that to my imaginary backlog.",
    ],
  },
  {
    id: "maya",
    name: "Maya",
    role: "UI Designer",
    color: "#e2574c",
    accent: "#7c2d26",
    skin: "#8d5a3b",
    hair: "bob",
    spawn: [4.5, -3],
    greetings: [
      "Hi hi! Welcome in. I'm Maya — I do the pixels.",
      "Hey! Perfect timing, I was just pixel-peeping.",
      "Oh hello! Come look at this spacing — tell me it's not too tight.",
    ],
    idle: [
      "Is it a button or a link? Decide, people.",
      "Spacing. Spacing. Spacing.",
      "I just made a 4px grid and my life is complete.",
      "This shadow is too dramatic. Shadows should be shy.",
    ],
    replies: [
      {
        keys: ["hello", "hi ", "hi!", "hey", "yo", "good morning"],
        answers: ["Hey hey! Welcome to my corner of the studio."],
      },
      {
        keys: ["spacing", "padding", "margin", "grid", "layout"],
        answers: [
          "Spacing is the personality of a design. Give it room.",
          "A good grid is like good manners — you only notice when it's missing.",
        ],
      },
      {
        keys: ["figma"],
        answers: [
          "Auto-layout changed my life. I don't hand-place anything anymore.",
        ],
      },
      {
        keys: ["color", "palette", "shade"],
        answers: ["Start with 60-30-10. It never fails."],
      },
      {
        keys: ["button", "component", "ui"],
        answers: [
          "Buttons: 8px padding feels safe, 16px feels friendly. Context matters.",
        ],
      },
      {
        keys: ["shadow", "elevation", "depth"],
        answers: ["Shadows should feel like soft light, not a heavy border."],
      },
      {
        keys: ["dark mode", "dark", "theme"],
        answers: ["Dark mode is just light mode in a trench coat."],
      },
      {
        keys: ["joke", "funny", "lol"],
        answers: ["My button hover states have hover states."],
      },
      {
        keys: ["bye", "later", "goodbye", "see you"],
        answers: ["Bye! Don't pixel-peep strangers."],
      },
      {
        keys: ["thanks", "thank you", "nice", "awesome"],
        answers: ["Anytime! Come bother me about spacing again."],
      },
    ],
    fallback: [
      "Ooh, good point. Let me try that in a frame.",
      "Hmm. I'd argue the spacing, but go on.",
      "I'm listening — my cursor is on the undo shortcut though.",
    ],
  },
  {
    id: "leo",
    name: "Leo",
    role: "Motion Designer",
    color: "#3fa06b",
    accent: "#274d39",
    skin: "#e0a878",
    hair: "fro",
    spawn: [6.5, 3.5],
    greetings: [
      "Yo! Welcome to the studio. I'm Leo — if it moves, I've keyframed it.",
      "Hey hey! Just easing a curve over here. Don't mind me.",
      "What's up! Want to see a transition? I made it 400ms, obviously.",
    ],
    idle: [
      "Everything should move at 60fps or not at all.",
      "Ease in. Ease out. Never linear.",
      "I animated a loading bar today. It was satisfying.",
      "Micro-interactions are the sprinkles of design.",
    ],
    replies: [
      {
        keys: ["hello", "hi ", "hey", "yo", "whats up", "what's up"],
        answers: ["Yo! Welcome to motion city."],
      },
      {
        keys: ["animation", "motion", "transition", "ease", "keyframe"],
        answers: [
          "Cubic-bezier is my love language.",
          "400ms in, 200ms out. The golden rule.",
        ],
      },
      {
        keys: ["fps", "frame", "smooth"],
        answers: ["If it's not 60fps, it's a slideshow."],
      },
      {
        keys: ["lottie", "json", "after effects", "ae"],
        answers: ["Lottie is the best. Send me the JSON, I'll make it dance."],
      },
      {
        keys: ["micro", "interaction", "hover", "button"],
        answers: ["Micro-interactions are the sprinkles of design."],
      },
      {
        keys: ["joke", "funny", "lol"],
        answers: ["My first animation was a bouncing ball. We've all been there."],
      },
      {
        keys: ["bye", "later", "see you"],
        answers: ["Peace! Keep it moving."],
      },
    ],
    fallback: [
      "Love it. I'd animate that, obviously.",
      "Smooth. Let's add a 200ms ease and call it a day.",
      "Interesting — that's a nice easing curve of a thought.",
    ],
  },
  {
    id: "priya",
    name: "Priya",
    role: "UX Researcher",
    color: "#9a6ff0",
    accent: "#4d2d8f",
    skin: "#a86e42",
    hair: "bun",
    spawn: [-6.5, 4],
    greetings: [
      "Hey! Welcome. I'm Priya — I ask users what they actually think.",
      "Hi there! Come, sit. I just finished a round of interviews.",
      "Oh hey! Perfect, I need a fresh pair of eyes for a usability test.",
    ],
    idle: [
      "Five users will find what fifty of you missed.",
      "Data over opinions. Always.",
      "I'm coding the interview transcripts right now. Riveting stuff.",
      "A confused user is a sign of a confused design.",
    ],
    replies: [
      {
        keys: ["hello", "hi ", "hey", "yo", "good morning"],
        answers: ["Hey! Welcome to the research corner."],
      },
      {
        keys: ["user", "research", "interview", "test", "usability", "ux"],
        answers: [
          "Talk to five users and your roadmap rewrites itself.",
          "Usability tests: watch what they do, not what they say.",
        ],
      },
      {
        keys: ["data", "insight", "feedback", "metrics"],
        answers: ["One observation beats three opinions."],
      },
      {
        keys: ["confused", "hard", "difficult", "problem"],
        answers: ["Confusion is data. It's telling you exactly what to fix."],
      },
      {
        keys: ["joke", "funny", "lol"],
        answers: ["My favourite study: 87% of users click the thing they say they won't."],
      },
      {
        keys: ["bye", "later", "see you"],
        answers: ["Bye! Go talk to a user today."],
      },
      {
        keys: ["thanks", "thank you", "nice", "awesome"],
        answers: ["Anytime! Bring me a prototype, I'll bring the users."],
      },
    ],
    fallback: [
      "Interesting. Let me note that down — for research.",
      "Hmm, I'd validate that with a quick study.",
      "Noted. Adding it to the interview script.",
    ],
  },
  {
    id: "diego",
    name: "Diego",
    role: "Brand Designer",
    color: "#f0a832",
    accent: "#7c4a12",
    skin: "#b57b4d",
    hair: "beanie",
    spawn: [0, 6],
    greetings: [
      "Hey! Welcome to the studio. I'm Diego — logos, type, identity. The fun stuff.",
      "What's up! Come check out this logo mark I'm fighting with.",
      "Hey hey! Branding is personality with a grid. I'll prove it.",
    ],
    idle: [
      "A logo is a promise with a gradient.",
      "Kerning is the quietest, loudest detail.",
      "I'm on the fifth round of 'make the logo bigger'.",
      "Your brand is what people say about you when you leave the room.",
    ],
    replies: [
      {
        keys: ["hello", "hi ", "hey", "yo", "whats up"],
        answers: ["Hey! Welcome to the brand corner."],
      },
      {
        keys: ["logo", "brand", "identity", "mark"],
        answers: [
          "A logo should work at 16 pixels and on a billboard.",
          "Branding is personality with a grid.",
        ],
      },
      {
        keys: ["type", "font", "kerning", "typography"],
        answers: ["Kerning is the quietest, loudest detail in design."],
      },
      {
        keys: ["color", "palette"],
        answers: ["Two colours and a story. That's a brand."],
      },
      {
        keys: ["bigger", "make it bigger", "font size"],
        answers: ["Every designer has survived a 'make the logo bigger' round."],
      },
      {
        keys: ["joke", "funny", "lol"],
        answers: ["My last logo was 40% negative space and 60% panic."],
      },
      {
        keys: ["bye", "later", "see you"],
        answers: ["Later! Keep the brand consistent."],
      },
    ],
    fallback: [
      "Ooh, I'd explore that in a moodboard first.",
      "Solid. That has personality — and a grid.",
      "Interesting angle. Let me sketch that on a napkin.",
    ],
  },
];

/** Designers can be anywhere in this list — matches by substring, first match wins. */
export function pickReply(persona: Persona, message: string): string {
  const text = message.toLowerCase().trim();
  for (const group of persona.replies) {
    if (group.keys.some((key) => text.includes(key))) {
      const answers = group.answers;
      return answers[Math.floor(Math.random() * answers.length)];
    }
  }
  const fb = persona.fallback;
  return fb[Math.floor(Math.random() * fb.length)];
}

export function pickGreeting(persona: Persona): string {
  const g = persona.greetings;
  return g[Math.floor(Math.random() * g.length)];
}

export function pickIdle(persona: Persona): string {
  const i = persona.idle;
  return i[Math.floor(Math.random() * i.length)];
}

export function personaById(id: string): Persona {
  return PERSONAS.find((p) => p.id === id) ?? PERSONAS[0];
}
