'use client';

let elevation: string | null = null;
export function setAdminElevation(token: string | null) { elevation = token; }
export function getAdminElevation() { return elevation; }
