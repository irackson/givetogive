export type ArrFromStr<T extends string> =
	`${T}` extends `${infer First extends string}${infer Tail extends string}` ?
		[First, ...ArrFromStr<Tail>]
	:	[];

export type LengthOfString<S extends string> = ArrFromStr<S>['length'];
