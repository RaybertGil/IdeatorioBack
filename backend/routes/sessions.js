// routes/sessions.js
import express from 'express';
import Session from '../models/Session.js';
import Participant from '../models/Participant.js';
import Idea from '../models/Idea.js';


const router = express.Router();

// Crear una nueva sesión
router.post('/create-session', async (req, res) => {
  const { type, host_user_id } = req.body;

  try {
    // Generar un PIN único
    const pin = Math.floor(100000 + Math.random() * 900000).toString();

    // Crear la sesión
    const session = await Session.create({ type, pin, host_user_id });

    // Asociar ideas generadas previamente (sin session_id) a la nueva sesión
    await Idea.update(
      { session_id: session.id }, // Asigna el session_id
      { where: { session_id: null } } // Filtra ideas que no tienen session_id asociado
    );

    res.json({ session });
  } catch (error) {
    console.error('Error al crear la sesión:', error);
    res.status(500).json({ error: 'Error al crear la sesión' });
  }
});


// Unirse a una sesión existente
router.post('/join-session', async (req, res) => {
  const { pin, name } = req.body;

  try {
    const session = await Session.findOne({ where: { pin } });
    if (!session) return res.status(404).json({ error: 'PIN inválido' });

    const participant = await Participant.create({ session_id: session.id, name });
    res.json({ participant });
  } catch (error) {
    res.status(500).json({ error: 'Error al unirse a la sesión' });
  }
});

// Obtener participantes por PIN
router.get('/participants/:pin', async (req, res) => {
    const { pin } = req.params;
  
    try {
      // Buscar la sesión por el PIN
      const session = await Session.findOne({ where: { pin } });
      if (!session) {
        return res.status(404).json({ error: 'Sesión no encontrada' });
      }
  
      // Obtener los participantes de la sesión
      const participants = await Participant.findAll({ where: { session_id: session.id } });
  
      res.json({ participants });
    } catch (error) {
      res.status(500).json({ error: 'Error al obtener participantes' });
    }
  });

export default router;
