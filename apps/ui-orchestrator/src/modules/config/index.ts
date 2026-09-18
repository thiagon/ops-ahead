import fp from 'fastify-plugin';
import { registerConfigRoutes } from './routes.ts';
import { ConfigService } from './service.ts';
import { createVaultSecretStore } from './vault.ts';

declare module 'fastify' {
  interface FastifyInstance {
    configService: ConfigService;
  }
}

export default fp(
  async app => {
    if (!app.hasDecorator('configService')) {
      app.decorate(
        'configService',
        new ConfigService(
          app.sql,
          app.kafka,
          {
            origin: app.env.KAFKA_TOPIC_CONFIG_ORIGIN,
            dictionary: app.env.KAFKA_TOPIC_CONFIG_DICTIONARY,
            deadline: app.env.KAFKA_TOPIC_CONFIG_DEADLINE,
            kpiTarget: app.env.KAFKA_TOPIC_CONFIG_KPI_TARGET,
          },
          createVaultSecretStore({
            address: app.env.VAULT_ADDR,
            kvMount: app.env.VAULT_KV_MOUNT,
            secretPath: app.env.VAULT_SECRET_PATH,
            role: app.env.VAULT_ROLE,
            tokenPath: app.env.VAULT_TOKEN_PATH,
          }),
        ),
      );
    }

    registerConfigRoutes(app);
  },
  { name: 'config', dependencies: ['env', 'kafka', 'postgres'] },
);
