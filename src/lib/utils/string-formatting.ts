import { Schema } from 'effect';

////////////////////////////////////////////////////////////////////////////////
// #region varNameToHumanReadable
/**
 * Helper to split camelCase words by inserting spaces before uppercase letters.
 *
 * @template S - The input string type.
 * @example
 * type Result = SplitCamelCase<'myVariableName'>; // 'my Variable Name'
 */
type SplitCamelCase<S extends string> = S extends `${infer Head}${infer Tail}`
	? Tail extends Uncapitalize<Tail>
		? `${Head}${SplitCamelCase<Tail>}`
		: `${Head} ${SplitCamelCase<Tail>}`
	: S;

/**
 * Helper to replace underscores and hyphens with spaces.
 *
 * @template S - The input string type.
 * @example
 * type Result = SplitSnakeAndKebabCase<'another_example-here'>; // 'another example here'
 */
type SplitSnakeAndKebabCase<S extends string> =
	S extends `${infer Head}_${infer Tail}`
		? `${Head} ${SplitSnakeAndKebabCase<Tail>}`
		: S extends `${infer Head}-${infer Tail}`
			? `${Head} ${SplitSnakeAndKebabCase<Tail>}`
			: S;

/**
 * Combines all splitting helpers to handle camelCase, snake_case, and kebab-case.
 *
 * @template S - The input string type.
 * @example
 * type Result = SplitAllCases<'testCase_string-example'>; // 'test Case string example'
 */
type SplitAllCases<S extends string> = SplitCamelCase<
	SplitSnakeAndKebabCase<S>
>;

/**
 * Helper to capitalize each word in a space-separated string.
 *
 * @template S - The input string type.
 * @example
 * type Result = CapitalizeWords<'hello world'>; // 'Hello World'
 */
type CapitalizeWords<S extends string> = S extends `${infer Word} ${infer Rest}`
	? `${Capitalize<Word>} ${CapitalizeWords<Rest>}`
	: Capitalize<S>;

/**
 * Converts a string from camelCase, snake_case, or kebab-case to a human-readable format with capitalized words.
 *
 * @template S - The input string type.
 * @example
 * type Example1 = HumanReadable<'myVariableName'>;          // 'My Variable Name'
 * type Example2 = HumanReadable<'another_example_here'>;    // 'Another Example Here'
 * type Example3 = HumanReadable<'test-case-string'>;        // 'Test Case String'
 */
export type HumanReadable<S extends string> = CapitalizeWords<SplitAllCases<S>>;

/**
 * Converts a variable name from camelCase, snake_case, or kebab-case to a human-readable string with capitalized words.
 *
 * @template T - The input string literal type.
 * @param varName - The variable name to convert.
 * @returns The human-readable string.
 * @example
 * const result = varNameToHumanReadable('myVariableName'); // 'My Variable Name'
 * const result2 = varNameToHumanReadable('another_example_here'); // 'Another Example Here'
 * const result3 = varNameToHumanReadable('test-case-string'); // 'Test Case String'
 */
export const varNameToHumanReadable = <const T extends string>(
	varName: T,
): HumanReadable<T> => {
	const pipeline = Schema.transform(Schema.String, Schema.String, {
		strict: true,
		decode: (str: string) =>
			str
				.replace(/([A-Z])/g, ' $1') // Insert space before uppercase letters
				.replace(/[_-]/g, ' ') // Replace underscores and hyphens with spaces
				.replace(/\b\w/g, (char) => char.toUpperCase()) // Capitalize the first letter of each word
				.trim(),
		// Encode function: no-op (returns the string as is)
		encode: (str) => str,
	});

	const pipelineFunc = Schema.decodeUnknownSync(pipeline);

	const result = pipelineFunc(varName);

	return result as HumanReadable<T>;
};
// #endregion
////////////////////////////////////////////////////////////////////////////////
