import { getModerationConfig } from "./config";
import { normalizeText } from "./normalize";
import type { ModerationDecision, RuleHit, TextModerationInput } from "./types";

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s]+/gi;
const USERNAME_PATTERN = /@\w{2,}/g;
const HASHTAG_PATTERN = /#\w{2,}/g;
const REFERRAL_PATTERN = /\b(?:ref(?:erral)?|promo|invite)[-_ ]?(?:code|link)\b/i;
const PHISHING_PATTERN = /\b(?:verify your account|password reset|wallet seed|seed phrase|login to claim)\b/i;
const CRYPTO_PATTERN = /\b(?:crypto|bitcoin|btc|ethereum|airdrop|wallet|web3)\b/i;
const CASINO_PATTERN = /\b(?:casino|betting|sportsbook|jackpot|slot machine)\b/i;

function emptyDecision(status: "approved" | "review" | "rejected", reason: string): ModerationDecision {
  return {
    status,
    allowed: status === "approved",
    reason,
    provider: "local-rules",
    confidence: status === "approved" ? 0.99 : 1,
    triggered_rules: [],
    scores: {},
    duration_ms: 0,
  };
}

function maxStatus(hits: RuleHit[]): "approved" | "review" | "rejected" {
  if (hits.some((hit) => hit.action === "rejected")) return "rejected";
  if (hits.some((hit) => hit.action === "review")) return "review";
  return "approved";
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

function containsTerm(text: string, term: string): boolean {
  const normalizedTerm = normalizeText(term);
  if (normalizedTerm.includes(" ")) return text.includes(normalizedTerm);
  return new RegExp(`\\b${normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);
}

export function moderateWithLocalTextRules(input: TextModerationInput): ModerationDecision {
  const start = Date.now();
  const config = getModerationConfig();
  const raw = input.content;

  if (typeof raw !== "string") return emptyDecision("rejected", "Malformed text payload.");
  if (!raw.trim()) return emptyDecision("rejected", "Text cannot be empty.");
  if (raw.length > config.text.maxLength) return emptyDecision("rejected", "Text exceeds maximum length.");

  const normalized = normalizeText(raw);
  // If raw has content but normalizes to empty, the message is emoji/symbol-only — allow it.
  if (!normalized) return emptyDecision("approved", "");

  const hits: RuleHit[] = [];
  const scores: Record<string, number> = {};

  const urls = countMatches(raw, URL_PATTERN);
  const usernames = countMatches(raw, USERNAME_PATTERN);
  const hashtags = countMatches(raw, HASHTAG_PATTERN);

  if (/(.)\1{12,}/u.test(raw)) {
    hits.push({ rule: "repeated_characters", category: "spam", action: "review", confidence: 0.78 });
    scores.repeated_characters = 0.78;
  }
  if (urls > config.text.repeatedLinkLimit) {
    hits.push({ rule: "repeated_links", category: "spam", action: "rejected", confidence: 0.94 });
    scores.repeated_links = 0.94;
  }
  if (hashtags > config.text.repeatedHashtagLimit) {
    hits.push({ rule: "repeated_hashtags", category: "spam", action: "review", confidence: 0.82 });
    scores.repeated_hashtags = 0.82;
  }
  if (usernames > 8) {
    hits.push({ rule: "repeated_usernames", category: "spam", action: "review", confidence: 0.82 });
    scores.repeated_usernames = 0.82;
  }
  if (REFERRAL_PATTERN.test(raw)) {
    hits.push({ rule: "referral_spam", category: "spam", action: "review", confidence: 0.78 });
    scores.referral_spam = 0.78;
  }
  if ((CRYPTO_PATTERN.test(raw) || CASINO_PATTERN.test(raw)) && /(?:guaranteed|profit|bonus|claim|airdrop|win)/i.test(raw)) {
    hits.push({ rule: "financial_or_casino_spam", category: "scams", action: "rejected", confidence: 0.93 });
    scores.financial_or_casino_spam = 0.93;
  }
  if (PHISHING_PATTERN.test(raw)) {
    hits.push({ rule: "phishing_language", category: "scams", action: "rejected", confidence: 0.95 });
    scores.phishing_language = 0.95;
  }

  for (const term of config.profanity) {
    if (containsTerm(normalized, term)) {
      hits.push({ rule: "profanity", category: "profanity", action: "review", confidence: 0.76, detail: term });
      scores.profanity = Math.max(scores.profanity ?? 0, 0.76);
    }
  }

  for (const keywordRule of config.keywords) {
    for (const term of keywordRule.terms) {
      if (containsTerm(normalized, term)) {
        hits.push({
          rule: "keyword",
          category: keywordRule.category,
          action: keywordRule.action,
          confidence: keywordRule.action === "rejected" ? 0.95 : 0.82,
          detail: term,
        });
        scores[`keyword_${keywordRule.category}`] = Math.max(
          scores[`keyword_${keywordRule.category}`] ?? 0,
          keywordRule.action === "rejected" ? 0.95 : 0.82,
        );
      }
    }
  }

  const status = maxStatus(hits);
  const confidence = hits.length ? Math.max(...hits.map((hit) => hit.confidence)) : 0.99;
  const reason = hits.length ? hits.map((hit) => hit.category).filter((v, i, arr) => arr.indexOf(v) === i).join(", ") : "";

  return {
    status,
    allowed: status === "approved",
    reason,
    provider: "local-rules",
    confidence,
    triggered_rules: hits,
    scores,
    duration_ms: Date.now() - start,
  };
}
