// Reuse the reviewed bounded authenticated-encryption transport; no IO/import effects.
export {
	encryptionKey,
	seal,
	unseal,
} from '../tools/simulation/src/hosted-community-bundle.ts';
