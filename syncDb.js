// syncDb.js
import dotenv from 'dotenv';
dotenv.config({ path: './backend/openai.env' }); // Asegúrate de usar la ruta correcta

import sequelize from './backend/config/db.js';
import Session from './backend/models/Session.js';
import Participant from './backend/models/Participant.js';
import Idea from './backend/models/Idea.js'; // Importar el modelo Idea

// Relacionar tablas
Session.hasMany(Participant, { foreignKey: 'session_id' });
Participant.belongsTo(Session, { foreignKey: 'session_id' });

Session.hasMany(Idea, { foreignKey: 'session_id' }); // Relación: Una sesión tiene muchas ideas
Idea.belongsTo(Session, { foreignKey: 'session_id' }); // Relación inversa: Una idea pertenece a una sesión

// Sincronizar base de datos
sequelize
  .sync({ alter: true }) // Usa alter:true para actualizar tablas existentes sin borrar datos
  .then(() => console.log('Tablas sincronizadas con éxito.'))
  .catch((err) => console.error('Error al sincronizar las tablas:', err));
