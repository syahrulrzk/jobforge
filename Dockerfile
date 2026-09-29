FROM oven/bun:1.4-alpine

WORKDIR /app

# Install dependencies
COPY package.json bun.lock ./
RUN bun install

# Copy source
COPY src ./src
COPY prisma ./prisma
COPY public ./public
COPY next.config.ts ./
COPY tsconfig.json ./

# DATABASE_URL placeholder untuk build (runtime dipakai dari environment compose).
# Prisma client wajib di-generate setelah schema tersedia.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN bunx prisma generate && bun run build

# Expose port
EXPOSE 3000

# Start: sinkronkan schema (db push, aman idempotent) lalu jalankan server standalone.
# Kredensial dashboard lewat env DASHBOARD_USERNAME / DASHBOARD_PASSWORD.
CMD ["sh", "-c", "bunx prisma db push --skip-generate && bun run start"]
