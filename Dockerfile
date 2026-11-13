FROM node:22-bookworm-slim
WORKDIR /app
COPY --chown=node:node package.json server.js ./
COPY --chown=node:node src/ ./src/
COPY --chown=node:node public/ ./public/
RUN mkdir -p /app/data/attachments && chown -R node:node /app/data
USER node
ENV NODE_ENV=production PORT=4317 HOST=0.0.0.0 HAUSKOSTEN_DATA=/app/data
EXPOSE 4317
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD node -e "fetch('http://127.0.0.1:4317/').then(r => process.exit(r.ok?0:1)).catch(() => process.exit(1))"
CMD ["node", "server.js"]
