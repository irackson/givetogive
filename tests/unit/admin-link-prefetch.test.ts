import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// Source policy only; hosted click-through and network acceptance are separate.
function links(path: string) {
	const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
	const found: ts.JsxOpeningLikeElement[] = [];
	const visit = (node: ts.Node) => {
		if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === 'Link') found.push(node);
		ts.forEachChild(node, visit);
	};
	visit(source);
	return found;
}
function explicitDemandOnly(node: ts.JsxOpeningLikeElement) {
	return node.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText() === 'prefetch'
		&& attribute.initializer && ts.isJsxExpression(attribute.initializer)
		&& attribute.initializer.expression?.kind === ts.SyntaxKind.FalseKeyword);
}
test('large agent lists and live activity details load only after navigation intent', () => {
	const agent = links('src/app/_components/payments/AdminSimulations.tsx').filter(node => node.attributes.getText().includes("className='admin-agent'"));
	assert.equal(agent.length, 1);
	assert.ok(agent.every(explicitDemandOnly));
	const activity = links('src/app/_components/payments/AdminPrimitives.tsx');
	assert.equal(activity.length, 3);
	assert.ok(activity.every(explicitDemandOnly));
});
