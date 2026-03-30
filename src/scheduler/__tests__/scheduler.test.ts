/**
 * Unit tests for cron parsing functions in scheduler.ts
 * Uses node:test (built-in) with node:assert
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import {
	matchesCronField,
	matchesCron,
	getNextRunTime,
} from "../scheduler.ts";

describe("matchesCronField", () => {
	it("asterisk * matches any value", () => {
		assert.strictEqual(matchesCronField("*", 0, 0, 59), true);
		assert.strictEqual(matchesCronField("*", 30, 0, 59), true);
		assert.strictEqual(matchesCronField("*", 59, 0, 59), true);
		assert.strictEqual(matchesCronField("*", 5, 0, 23), true);
	});

	it("step */5 matches 0, 5, 10, 15... (relative to min)", () => {
		assert.strictEqual(matchesCronField("*/5", 0, 0, 59), true);
		assert.strictEqual(matchesCronField("*/5", 5, 0, 59), true);
		assert.strictEqual(matchesCronField("*/5", 10, 0, 59), true);
		assert.strictEqual(matchesCronField("*/5", 15, 0, 59), true);
		assert.strictEqual(matchesCronField("*/5", 55, 0, 59), true);
		assert.strictEqual(matchesCronField("*/5", 1, 0, 59), false);
		assert.strictEqual(matchesCronField("*/5", 3, 0, 59), false);
		assert.strictEqual(matchesCronField("*/5", 7, 0, 59), false);
	});

	it("step */15 for minutes: matches 0, 15, 30, 45", () => {
		assert.strictEqual(matchesCronField("*/15", 0, 0, 59), true);
		assert.strictEqual(matchesCronField("*/15", 15, 0, 59), true);
		assert.strictEqual(matchesCronField("*/15", 30, 0, 59), true);
		assert.strictEqual(matchesCronField("*/15", 45, 0, 59), true);
		assert.strictEqual(matchesCronField("*/15", 5, 0, 59), false);
		assert.strictEqual(matchesCronField("*/15", 20, 0, 59), false);
		assert.strictEqual(matchesCronField("*/15", 50, 0, 59), false);
	});

	it("exact number 30 matches only 30", () => {
		assert.strictEqual(matchesCronField("30", 30, 0, 59), true);
		assert.strictEqual(matchesCronField("30", 29, 0, 59), false);
		assert.strictEqual(matchesCronField("30", 31, 0, 59), false);
		assert.strictEqual(matchesCronField("30", 0, 0, 59), false);
	});

	it("list 1,15,30 matches 1, 15, 30 but not 2", () => {
		assert.strictEqual(matchesCronField("1,15,30", 1, 0, 59), true);
		assert.strictEqual(matchesCronField("1,15,30", 15, 0, 59), true);
		assert.strictEqual(matchesCronField("1,15,30", 30, 0, 59), true);
		assert.strictEqual(matchesCronField("1,15,30", 2, 0, 59), false);
		assert.strictEqual(matchesCronField("1,15,30", 10, 0, 59), false);
		assert.strictEqual(matchesCronField("1,15,30", 45, 0, 59), false);
	});

	it("range 5-10 matches 5,6,7,8,9,10 but not 4 or 11", () => {
		assert.strictEqual(matchesCronField("5-10", 5, 0, 59), true);
		assert.strictEqual(matchesCronField("5-10", 6, 0, 59), true);
		assert.strictEqual(matchesCronField("5-10", 7, 0, 59), true);
		assert.strictEqual(matchesCronField("5-10", 8, 0, 59), true);
		assert.strictEqual(matchesCronField("5-10", 9, 0, 59), true);
		assert.strictEqual(matchesCronField("5-10", 10, 0, 59), true);
		assert.strictEqual(matchesCronField("5-10", 4, 0, 59), false);
		assert.strictEqual(matchesCronField("5-10", 11, 0, 59), false);
		assert.strictEqual(matchesCronField("5-10", 0, 0, 59), false);
	});

	it("invalid step */0 returns false", () => {
		assert.strictEqual(matchesCronField("*/0", 0, 0, 59), false);
		assert.strictEqual(matchesCronField("*/0", 5, 0, 59), false);
	});

	it("invalid step */abc returns false", () => {
		assert.strictEqual(matchesCronField("*/abc", 0, 0, 59), false);
		assert.strictEqual(matchesCronField("*/abc", 5, 0, 59), false);
	});

	it("invalid exact abc returns false", () => {
		assert.strictEqual(matchesCronField("abc", 0, 0, 59), false);
		assert.strictEqual(matchesCronField("abc", 30, 0, 59), false);
	});

	it("edge: min=0 value=0 with */2 should match (0 % 2 === 0)", () => {
		assert.strictEqual(matchesCronField("*/2", 0, 0, 59), true);
		assert.strictEqual(matchesCronField("*/2", 2, 0, 59), true);
		assert.strictEqual(matchesCronField("*/2", 4, 0, 59), true);
		assert.strictEqual(matchesCronField("*/2", 1, 0, 59), false);
	});

	it("edge: min=1 value=1 with */2 should match (day of month)", () => {
		assert.strictEqual(matchesCronField("*/2", 1, 1, 31), true);
		assert.strictEqual(matchesCronField("*/2", 3, 1, 31), true);
		assert.strictEqual(matchesCronField("*/2", 5, 1, 31), true);
		assert.strictEqual(matchesCronField("*/2", 2, 1, 31), false);
		assert.strictEqual(matchesCronField("*/2", 4, 1, 31), false);
	});
});

describe("matchesCron", () => {
	it("* * * * * matches any date", () => {
		const date = new Date(2025, 0, 6, 9, 30, 0); // Jan 6 2025, 9:30 AM (Monday)
		assert.strictEqual(matchesCron("* * * * *", date), true);

		const anotherDate = new Date(2025, 5, 15, 23, 59, 0); // Jun 15 2025, 11:59 PM
		assert.strictEqual(matchesCron("* * * * *", anotherDate), true);
	});

	it("0 12 * * * matches only noon", () => {
		const noon = new Date(2025, 0, 6, 12, 0, 0);
		assert.strictEqual(matchesCron("0 12 * * *", noon), true);

		const notNoon1 = new Date(2025, 0, 6, 12, 1, 0);
		assert.strictEqual(matchesCron("0 12 * * *", notNoon1), false);

		const notNoon2 = new Date(2025, 0, 6, 11, 0, 0);
		assert.strictEqual(matchesCron("0 12 * * *", notNoon2), false);

		const notNoon3 = new Date(2025, 0, 6, 13, 0, 0);
		assert.strictEqual(matchesCron("0 12 * * *", notNoon3), false);
	});

	it("30 9 * * 1 matches Monday 9:30 only", () => {
		// Jan 6 2025 is a Monday
		const monday930 = new Date(2025, 0, 6, 9, 30, 0);
		assert.strictEqual(matchesCron("30 9 * * 1", monday930), true);

		const monday931 = new Date(2025, 0, 6, 9, 31, 0);
		assert.strictEqual(matchesCron("30 9 * * 1", monday931), false);

		const monday940 = new Date(2025, 0, 6, 9, 40, 0);
		assert.strictEqual(matchesCron("30 9 * * 1", monday940), false);

		const tuesday930 = new Date(2025, 0, 7, 9, 30, 0); // Tuesday
		assert.strictEqual(matchesCron("30 9 * * 1", tuesday930), false);

		const sunday930 = new Date(2025, 0, 5, 9, 30, 0); // Sunday (dow=0)
		assert.strictEqual(matchesCron("30 9 * * 1", sunday930), false);
	});

	it("0 0 1 1 * matches midnight Jan 1", () => {
		const jan1Midnight = new Date(2025, 0, 1, 0, 0, 0);
		assert.strictEqual(matchesCron("0 0 1 1 *", jan1Midnight), true);

		const jan1Noon = new Date(2025, 0, 1, 12, 0, 0);
		assert.strictEqual(matchesCron("0 0 1 1 *", jan1Noon), false);

		const jan2Midnight = new Date(2025, 0, 2, 0, 0, 0);
		assert.strictEqual(matchesCron("0 0 1 1 *", jan2Midnight), false);

		const feb1Midnight = new Date(2025, 1, 1, 0, 0, 0);
		assert.strictEqual(matchesCron("0 0 1 1 *", feb1Midnight), false);
	});

	it("*/15 * * * * matches :00, :15, :30, :45", () => {
		const m00 = new Date(2025, 0, 6, 9, 0, 0);
		assert.strictEqual(matchesCron("*/15 * * * *", m00), true);

		const m15 = new Date(2025, 0, 6, 9, 15, 0);
		assert.strictEqual(matchesCron("*/15 * * * *", m15), true);

		const m30 = new Date(2025, 0, 6, 9, 30, 0);
		assert.strictEqual(matchesCron("*/15 * * * *", m30), true);

		const m45 = new Date(2025, 0, 6, 9, 45, 0);
		assert.strictEqual(matchesCron("*/15 * * * *", m45), true);

		const m05 = new Date(2025, 0, 6, 9, 5, 0);
		assert.strictEqual(matchesCron("*/15 * * * *", m05), false);

		const m20 = new Date(2025, 0, 6, 9, 20, 0);
		assert.strictEqual(matchesCron("*/15 * * * *", m20), false);
	});

	it("returns false for wrong number of fields (e.g., 4 or 6 fields)", () => {
		const date = new Date(2025, 0, 6, 9, 30, 0);
		assert.strictEqual(matchesCron("* * * *", date), false); // 4 fields
		assert.strictEqual(matchesCron("* * * * * *", date), false); // 6 fields
		assert.strictEqual(matchesCron("* * *", date), false); // 3 fields
		assert.strictEqual(matchesCron("", date), false); // 0 fields
	});

	it("combination: 0 9 * * 1-5 matches weekday mornings", () => {
		// Jan 6 2025 is Monday (dow=1)
		const monday9am = new Date(2025, 0, 6, 9, 0, 0);
		assert.strictEqual(matchesCron("0 9 * * 1-5", monday9am), true);

		const tuesday9am = new Date(2025, 0, 7, 9, 0, 0);
		assert.strictEqual(matchesCron("0 9 * * 1-5", tuesday9am), true);

		const friday9am = new Date(2025, 0, 10, 9, 0, 0);
		assert.strictEqual(matchesCron("0 9 * * 1-5", friday9am), true);

		const saturday9am = new Date(2025, 0, 11, 9, 0, 0); // Saturday (dow=6)
		assert.strictEqual(matchesCron("0 9 * * 1-5", saturday9am), false);

		const sunday9am = new Date(2025, 0, 5, 9, 0, 0); // Sunday (dow=0)
		assert.strictEqual(matchesCron("0 9 * * 1-5", sunday9am), false);

		const monday10am = new Date(2025, 0, 6, 10, 0, 0);
		assert.strictEqual(matchesCron("0 9 * * 1-5", monday10am), false);
	});
});

describe("getNextRunTime", () => {
	it("* * * * * returns exactly 1 minute after fromDate", () => {
		const fromDate = new Date(2025, 0, 6, 9, 30, 0);
		const result = getNextRunTime("* * * * *", fromDate);
		const expected = new Date(2025, 0, 6, 9, 31, 0).getTime();
		assert.strictEqual(result, expected);
	});

	it("0 12 * * * from 11:00 returns 12:00 same day", () => {
		const fromDate = new Date(2025, 0, 6, 11, 0, 0);
		const result = getNextRunTime("0 12 * * *", fromDate);
		const expected = new Date(2025, 0, 6, 12, 0, 0).getTime();
		assert.strictEqual(result, expected);
	});

	it("0 12 * * * from 13:00 returns 12:00 next day", () => {
		const fromDate = new Date(2025, 0, 6, 13, 0, 0);
		const result = getNextRunTime("0 12 * * *", fromDate);
		const expected = new Date(2025, 0, 7, 12, 0, 0).getTime();
		assert.strictEqual(result, expected);
	});

	it("0 0 1 1 * returns Jan 1 midnight (possibly next year)", () => {
		// From Jan 6 2025, next Jan 1 is in 2026
		const fromDate = new Date(2025, 0, 6, 9, 30, 0);
		const result = getNextRunTime("0 0 1 1 *", fromDate);
		const expected = new Date(2026, 0, 1, 0, 0, 0).getTime();
		assert.strictEqual(result, expected);
	});

	it("returns a number (timestamp in ms)", () => {
		const fromDate = new Date(2025, 0, 6, 9, 30, 0);
		const result = getNextRunTime("0 12 * * *", fromDate);
		assert.strictEqual(typeof result, "number");
		assert.ok(result !== null);
	});

	it("result is always in the future relative to fromDate", () => {
		const fromDate = new Date(2025, 0, 6, 9, 30, 0);

		const result1 = getNextRunTime("* * * * *", fromDate);
		assert.ok(result1 !== null && result1 > fromDate.getTime());

		const result2 = getNextRunTime("0 12 * * *", fromDate);
		assert.ok(result2 !== null && result2 > fromDate.getTime());

		const result3 = getNextRunTime("0 0 1 1 *", fromDate);
		assert.ok(result3 !== null && result3 > fromDate.getTime());

		const result4 = getNextRunTime("*/15 * * * *", fromDate);
		assert.ok(result4 !== null && result4 > fromDate.getTime());
	});
});
