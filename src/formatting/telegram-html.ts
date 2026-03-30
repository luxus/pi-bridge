/**
 * pi-bridge — Markdown to Telegram HTML converter.
 *
 * Telegram supports: <b>, <i>, <u>, <s>, <code>, <pre>,
 * <pre><code class="language-X">, <a href>, <blockquote>,
 * <blockquote expandable>, <tg-spoiler>.
 *
 * NOT supported: headings, lists, tables, images, hr, br.
 * These are converted to plain-text equivalents.
 */

export function markdownToTelegramHtml(markdown: string): string {
	const lines = markdown.split("\n");
	const result: string[] = [];
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];

		// Fenced code block
		const fenceMatch = line.match(/^```(\w*)\s*$/);
		if (fenceMatch) {
			const language = fenceMatch[1];
			const codeLines: string[] = [];
			i++;
			while (i < lines.length && !lines[i].match(/^```\s*$/)) {
				codeLines.push(escapeHtml(lines[i]));
				i++;
			}
			i++;

			if (language) {
				result.push(`<pre><code class="language-${escapeHtml(language)}">${codeLines.join("\n")}</code></pre>`);
			} else {
				result.push(`<pre>${codeLines.join("\n")}</pre>`);
			}
			continue;
		}

		// Heading → bold (Telegram has no heading tags)
		const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
		if (headingMatch) {
			result.push(`<b>${convertInline(headingMatch[2])}</b>`);
			i++;
			continue;
		}

		// Blockquote
		if (line.startsWith("> ") || line === ">") {
			const quoteLines: string[] = [];
			while (i < lines.length && (lines[i].startsWith("> ") || lines[i] === ">")) {
				quoteLines.push(lines[i].replace(/^>\s?/, ""));
				i++;
			}
			const quoteContent = quoteLines.map(l => convertInline(l)).join("\n");
			result.push(`<blockquote>${quoteContent}</blockquote>`);
			continue;
		}

		// Horizontal rule → unicode separator
		if (line.match(/^[-*_]{3,}\s*$/)) {
			result.push("—————");
			i++;
			continue;
		}

		// Unordered list item → bullet
		const ulMatch = line.match(/^(\s*)[-*+]\s+(.+)$/);
		if (ulMatch) {
			const indent = Math.floor(ulMatch[1].length / 2);
			result.push("  ".repeat(indent) + "• " + convertInline(ulMatch[2]));
			i++;
			continue;
		}

		// Ordered list item → number
		const olMatch = line.match(/^(\s*)(\d+)[.)]\s+(.+)$/);
		if (olMatch) {
			const indent = Math.floor(olMatch[1].length / 2);
			result.push("  ".repeat(indent) + `${olMatch[2]}. ` + convertInline(olMatch[3]));
			i++;
			continue;
		}

		result.push(convertInline(line));
		i++;
	}

	return result.join("\n");
}

/**
 * Convert inline markdown formatting to Telegram HTML.
 * Handles code spans first to prevent formatting inside them.
 */
function convertInline(text: string): string {
	const segments: string[] = [];
	let remaining = text;

	// Split on inline code spans — code content gets escaped but not formatted
	while (remaining.length > 0) {
		const codeMatch = remaining.match(/^(.*?)(`{1,2})(.+?)\2(.*)$/s);
		if (codeMatch) {
			if (codeMatch[1]) {
				segments.push(formatInline(codeMatch[1]));
			}
			segments.push(`<code>${escapeHtml(codeMatch[3])}</code>`);
			remaining = codeMatch[4];
		} else {
			segments.push(formatInline(remaining));
			break;
		}
	}

	return segments.join("");
}

/**
 * Apply inline formatting to a text segment that is NOT inside a code span.
 *
 * Order matters: bold+italic before bold before italic,
 * links before bare URLs. Escaping happens per-segment to
 * avoid mangling markdown syntax characters.
 */
function formatInline(text: string): string {
	// Extract links first (before escaping, since URLs contain & and special chars)
	const linkPlaceholders: string[] = [];
	text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, url) => {
		const idx = linkPlaceholders.length;
		linkPlaceholders.push(`<a href="${escapeAttr(url)}">${escapeHtml(label)}</a>`);
		return `%%LINK${idx}%%`;
	});

	// Extract bare URLs before escaping
	const urlPlaceholders: string[] = [];
	text = text.replace(/(https?:\/\/[^\s<>%]+)/g, (url) => {
		const idx = urlPlaceholders.length;
		urlPlaceholders.push(`<a href="${escapeAttr(url)}">${escapeHtml(url)}</a>`);
		return `%%URL${idx}%%`;
	});

	// Now escape HTML
	text = escapeHtml(text);

	// Bold + italic (***text*** or ___text___)
	text = text.replace(/\*{3}(.+?)\*{3}/g, "<b><i>$1</i></b>");
	text = text.replace(/_{3}(.+?)_{3}/g, "<b><i>$1</i></b>");

	// Bold (**text** or __text__)
	text = text.replace(/\*{2}(.+?)\*{2}/g, "<b>$1</b>");
	text = text.replace(/_{2}(.+?)_{2}/g, "<b>$1</b>");

	// Italic (*text* or _text_) — underscore only between word boundaries
	text = text.replace(/\*(.+?)\*/g, "<i>$1</i>");
	text = text.replace(/(?<!\w)_(.+?)_(?!\w)/g, "<i>$1</i>");

	// Strikethrough (~~text~~)
	text = text.replace(/~~(.+?)~~/g, "<s>$1</s>");

	// Spoiler (||text||)
	text = text.replace(/\|\|(.+?)\|\|/g, "<tg-spoiler>$1</tg-spoiler>");

	// Restore link placeholders
	for (let j = 0; j < linkPlaceholders.length; j++) {
		text = text.replace(`%%LINK${j}%%`, linkPlaceholders[j]);
	}
	for (let j = 0; j < urlPlaceholders.length; j++) {
		text = text.replace(`%%URL${j}%%`, urlPlaceholders[j]);
	}

	return text;
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function escapeAttr(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}
