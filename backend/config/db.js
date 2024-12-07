import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';

// Cargar las variables de entorno
dotenv.config({ path: './backend/openai.env' });

const {
  POSTGRES_HOST,
  POSTGRES_PORT,
  POSTGRES_USER,
  POSTGRES_PASSWORD,
  POSTGRES_DB,
} = process.env;

// Verificar si todas las variables necesarias están definidas
if (!POSTGRES_HOST || !POSTGRES_PORT || !POSTGRES_USER || !POSTGRES_PASSWORD || !POSTGRES_DB) {
  throw new Error('Las credenciales de la base de datos no están completamente definidas en las variables de entorno.');
}

// Configurar la conexión de Sequelize
const sequelize = new Sequelize(POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD, {
  host: POSTGRES_HOST,
  port: POSTGRES_PORT,
  dialect: 'postgres',
  dialectOptions: {
  },
  logging: false, // Desactiva logs SQL para reducir ruido
});

// Probar la conexión
sequelize
  .authenticate()
  .then(() => console.log('Conexión a la base de datos exitosa.'))
  .catch((err) => console.error('Error al conectar a la base de datos:', err));

export default sequelize;