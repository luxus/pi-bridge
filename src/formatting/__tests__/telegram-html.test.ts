/**
 * Unit tests for markdownToTelegramHtml
 * Run with: node --import=tsx --test src/formatting/__tests__/telegram-html.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { markdownToTelegramHtml } from "../telegram-html.ts";

describe("markdownToTelegramHtml", () => {
	describe("HTML escaping", () => {
		it("should escape < in plain text", () => {
			const input = "text < div";
			const expected = "text &lt; div";
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});

		it("should escape > in plain text", () => {
			const input = "text > div";
			const expected = "text &gt; div";
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});

		it("should escape & in plain text", () => {
			const input = "text & more";
			const expected = "text &amp; more";
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});

		it("should escape \" in plain text", () => {
			const input = 'text "quoted"';
			const expected = "text &quot;quoted&quot;";
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});

		it("should escape all special HTML characters together", () => {
			const input = '<div> & "text"';
			const expected = "&lt;div&gt; &amp; &quot;text&quot;";
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});
	});

	describe("Bold formatting", () => {
		it("should convert **text** to <b>text</b>", () => {
			const input = "**bold text**";
			const expected = "<b>bold text</b>";
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});

		it("should convert __text__ to <b>text</b>", () => {
			const input = "__bold text__";
			const expected = "<b>bold text</b>";
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});
	});

	describe("Italic formatting", () => {
		it("should convert *text* to <i>text</i>", () => {
			const input = "*italic text*";
			const expected = "<i>italic text</i>";
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});

		it("should convert _text_ to <i>text</i> between word boundaries", () => {
			const input = "_italic text_";
			const expected = "<i>italic text</i>";
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});

		it("should not convert _text_ when preceded by word character", () => {
			const input = "word_text_word";
			const expected = "word_text_word";
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});

		it("should not convert _text_ when followed by word character", () => {
			const input = "_text_word";
			const expected = "_text_word";
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});
	});

	describe("Bold+Italic formatting", () => {
		it("should convert ***text*** to <b><i>text</i></b>", () => {
			const input = "***bold italic***";
			const expected = "<b><i>bold italic</i></b>";
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});

		it("should convert ___text___ to <b><i>text</i></b>", () => {
			const input = "___bold italic___";
			const expected = "<b><i>bold italic</i></b>";
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});
	});

	describe("Strikethrough formatting", () => {
		it("should convert ~~text~~ to <s>text</s>", () => {
			const input = "~~strikethrough~~";
			const expected = "<s>strikethrough</s>";
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});
	});

	describe("Spoiler formatting", () => {
		it("should convert ||text|| to <tg-spoiler>text</tg-spoiler>", () => {
			const input = "||spoiler text||";
			const expected = "<tg-spoiler>spoiler text</tg-spoiler>";
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});
	});

	describe("Inline code", () => {
		it("should convert `code` to <code>code</code>", () => {
			const input = "`code`";
			const expected = "<code>code</code>";
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});

		it("should escape HTML inside inline code", () => {
			const input = "`<div>`";
			const expected = "<code>&lt;div&gt;</code>";
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});

		it("should not process markdown formatting inside inline code", () => {
			const input = "`**bold**`";
			const expected = "<code>**bold**</code>";
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});
	});

	describe("Fenced code blocks", () => {
		it("should convert fenced code block without language to <pre>", () => {
			const input = "```\ncode\n```";
			const expected = "<pre>code</pre>";
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});

		it("should convert fenced code block with language to <pre><code class=...>", () => {
			const input = "```js\ncode\n```";
			const expected = '<pre><code class="language-js">code</code></pre>';
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});

		it("should escape HTML inside code block", () => {
			const input = "```\n<div>\n```";
			const expected = "<pre>&lt;div&gt;</pre>";
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});

		it("should handle multi-line code blocks", () => {
			const input = "```\nline1\nline2\nline3\n```";
			const expected = "<pre>line1\nline2\nline3</pre>";
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});
	});

	describe("Headings", () => {
		it("should convert # Heading to <b>Heading</b>", () => {
			const input = "# Heading";
			const expected = "<b>Heading</b>";
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});

		it("should convert ## Heading to <b>Heading</b>", () => {
			const input = "## Heading";
			const expected = "<b>Heading</b>";
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});

		it("should convert ###### Heading to <b>Heading</b>", () => {
			const input = "###### Heading";
			const expected = "<b>Heading</b>";
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});

		it("should process inline formatting in heading content", () => {
			const input = "# Heading with **bold**";
			const expected = "<b>Heading with <b>bold</b></b>";
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});
	});

	describe("Blockquotes", () => {
		it("should convert > text to <blockquote>text</blockquote>", () => {
			const input = "> quote";
			const expected = "<blockquote>quote</blockquote>";
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});

		it("should handle multi-line blockquotes", () => {
			const input = "> line1\n> line2\n> line3";
			const expected = "<blockquote>line1\nline2\nline3</blockquote>";
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});

		it("should process inline formatting in blockquotes", () => {
			const input = "> quote with **bold**";
			const expected = "<blockquote>quote with <b>bold</b></blockquote>";
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});
	});

	describe("Horizontal rule", () => {
		it("should convert --- to unicode dashes", () => {
			const input = "---";
			const expected = "—————";
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});

		it("should convert *** to unicode dashes", () => {
			const input = "***";
			const expected = "—————";
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});

		it("should convert ___ to unicode dashes", () => {
			const input = "___";
			const expected = "—————";
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});
	});

	describe("Unordered lists", () => {
		it("should convert - item to bullet item", () => {
			const input = "- item";
			const expected = "• item";
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});

		it("should convert * item to bullet item", () => {
			const input = "* item";
			const expected = "• item";
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});

		it("should convert + item to bullet item", () => {
			const input = "+ item";
			const expected = "• item";
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});

		it("should handle nested items with indentation", () => {
			const input = "  - subitem";
			const expected = "  • subitem";
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});

		it("should process inline formatting in list items", () => {
			const input = "- item with **bold**";
			const expected = "• item with <b>bold</b>";
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});
	});

	describe("Ordered lists", () => {
		it("should convert 1. item to numbered item", () => {
			const input = "1. item";
			const expected = "1. item";
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});

		it("should convert 2) item to numbered item", () => {
			const input = "2) item";
			const expected = "2. item";
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});

		it("should handle nested items with indentation", () => {
			const input = "  1. subitem";
			const expected = "  1. subitem";
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});

		it("should process inline formatting in ordered list items", () => {
			const input = "1. item with *italic*";
			const expected = "1. item with <i>italic</i>";
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});
	});

	describe("Links", () => {
		it("should convert [text](url) to <a href=url>text</a>", () => {
			const input = "[link text](https://example.com)";
			const expected = '<a href="https://example.com">link text</a>';
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});

		it("should escape HTML in link text", () => {
			const input = '[link <div>](https://example.com)';
			const expected = '<a href="https://example.com">link &lt;div&gt;</a>';
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});

		it("should escape special chars in link URL", () => {
			const input = '[link](https://example.com?foo=1&bar=2)';
			const expected = '<a href="https://example.com?foo=1&amp;bar=2">link</a>';
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});
	});

	describe("Bare URLs", () => {
		it("should convert https://example.com to clickable link", () => {
			const input = "https://example.com";
			const expected = '<a href="https://example.com">https://example.com</a>';
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});

		it("should convert http://example.com to clickable link", () => {
			const input = "http://example.com";
			const expected = '<a href="http://example.com">http://example.com</a>';
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});

		it("should handle URLs with paths and query strings", () => {
			const input = "https://example.com/path?query=1";
			const expected = '<a href="https://example.com/path?query=1">https://example.com/path?query=1</a>';
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});
	});

	describe("Mixed content", () => {
		it("should handle paragraph with bold, italic, code, and links", () => {
			const input = "This has **bold**, *italic*, `code`, and [a link](https://example.com)";
			const expected = "This has <b>bold</b>, <i>italic</i>, <code>code</code>, and <a href=\"https://example.com\">a link</a>";
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});

		it("should handle complex mixed formatting", () => {
			const input = "**Bold** and ~~strikethrough~~ and ||spoiler||";
			const expected = "<b>Bold</b> and <s>strikethrough</s> and <tg-spoiler>spoiler</tg-spoiler>";
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});
	});

	describe("Edge cases", () => {
		it("should handle empty input", () => {
			const input = "";
			const expected = "";
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});

		it("should pass through plain text with HTML escaping", () => {
			const input = "Just plain text without markdown";
			const expected = "Just plain text without markdown";
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});

		it("should handle multiple paragraphs", () => {
			const input = "Paragraph 1\n\nParagraph 2";
			const expected = "Paragraph 1\n\nParagraph 2";
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});

		it("should handle text with special chars that looks like markdown", () => {
			const input = "Not *bold* because no closing";
			const expected = "Not <i>bold</i> because no closing";
			assert.strictEqual(markdownToTelegramHtml(input), expected);
		});
	});
});
