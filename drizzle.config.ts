// Drizzle Kit configuration file.
// Drizzle Kit is the companion CLI tool that reads your schema (schema.ts)
// and generates SQL migration files from it. This config tells it:
//   - where your schema is defined
//   - where to write the generated SQL migration files
//   - which database dialect to use (sqlite)
//   - which database file to connect to (only used by drizzle-kit studio, not the app)

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	// We are using SQLite
	dialect: 'sqlite',

	// The TypeScript file where all tables are defined
	schema: './src/lib/db/schema.ts',

	// Where to write the generated SQL migration files
	out: './drizzle/migrations',

	dbCredentials: {
		// DATABASE_URL can be set in your .env file or docker-compose.yml.
		// Falls back to ./data/db.sqlite for local development.
		url: process.env.DATABASE_URL ?? './data/db.sqlite'
	}
});
