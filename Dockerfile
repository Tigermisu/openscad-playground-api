# Build and run OpenSCAD REST API & Playground Service
FROM node:22-slim

# Install system dependencies (OpenSCAD native CLI for hardware/offscreen PNG rendering, git, and zip)
RUN apt-get update && apt-get install -y --no-install-recommends \
    openscad \
    git \
    zip \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install npm dependencies
RUN npm ci --include=dev

# Copy project files
COPY . .

# Build libraries and web playground assets
RUN npm run build:libs && npm run build

# Expose server port
EXPOSE 3000

ENV PORT=3000
ENV HOST=0.0.0.0
ENV NODE_ENV=production

# Start REST API server
CMD ["npm", "start"]
