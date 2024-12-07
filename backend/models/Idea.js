import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const Idea = sequelize.define('Idea', {
  text: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  votes: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  session_id: {
    type: DataTypes.INTEGER,
    allowNull: true, // Permitir valores nulos
  },
  type: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'idea', // Los valores posibles son "idea" o "subtopic" o "pregunta" u "opcion"
  },
  parent_id: {
    type: DataTypes.INTEGER,
    allowNull: true, // Permitir valores nulos, ya que solo las opciones tendrán este campo
    references: {
      model: 'Ideas', // Vincula el parent_id al modelo Idea, referenciando a la misma tabla
      key: 'id',
    },
  },
  correct: {
    type: DataTypes.BOOLEAN,
    defaultValue: false, // Solo será usado para opciones, si es la correcta o no
  },
});

export default Idea;
