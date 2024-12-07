// models/Session.js
import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const Session = sequelize.define('Session', {
  type: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  pin: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  host_user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  currentSlideContent: {
    type: DataTypes.JSON, // Para almacenar el contenido del slide como un objeto JSON
    allowNull: true, // Puede ser null inicialmente
  },
});

export default Session;
