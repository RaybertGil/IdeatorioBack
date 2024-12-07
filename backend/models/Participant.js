// models/Participant.js
import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const Participant = sequelize.define('Participant', {
  name: {
    type: DataTypes.STRING,
  },
  session_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
});

export default Participant;
