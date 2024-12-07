// Backend: server.js
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import sequelize from './config/db.js'; // Conexión modular a la base de datos
import sessionRoutes from './routes/sessions.js'; // Rutas para sesiones
import { OpenAI } from 'openai';
import Participant from './models/Participant.js'; // Modelo de Participant
import Session from './models/Session.js'; // Modelo de Session
import { Op } from 'sequelize';
import Idea from './models/Idea.js'; // Modelo de Idea
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: './backend/openai.env' }); // Configurar variables de entorno

// Inicializar App
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Middleware
app.use(cors({ origin: '*', methods: ['GET', 'POST'], credentials: true }));
app.use(express.json());

// Sincronizar Base de Datos
sequelize
  .sync()
  .then(() => console.log('Base de datos sincronizada exitosamente.'))
  .catch((error) => console.error('Error al sincronizar la base de datos:', error));

// Rutas
app.use('/api/sessions', sessionRoutes);

// Configuración de OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: 'https://api.openai.com/v1',
});

// Cliente Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Ruta para redirigir al inicio de sesión de Google
app.get('/auth/google', async (req, res) => {
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: 'https://worthy-empathy-production.up.railway.app/teacher-topic',
      },
    });
    if (error) throw error;
    res.redirect(data.url);
  } catch (err) {
    console.error('Error al iniciar sesión con Google:', err.message);
    res.status(500).json({ error: 'Error al iniciar sesión con Google' });
  }
});

// Ruta de callback para manejar la autenticación de Google
app.get('/auth/callback', async (req, res) => {
  const { error, data } = await supabase.auth.getUserByCookie(req);

  if (error) {
    console.error('Error obteniendo usuario autenticado:', error.message);
    return res.status(400).json({ error: 'No se pudo autenticar al usuario.' });
  }

  res.json({ user: data.user });
});

app.post('/api/submit-word', async (req, res) => {
  const { pin, text } = req.body;

  if (!pin || !text) {
    return res.status(400).json({ error: 'Debe proporcionar un PIN y una idea válida.' });
  }

  try {
    const session = await Session.findOne({ where: { pin } });
    if (!session) {
      return res.status(404).json({ error: 'Sesión no encontrada.' });
    }

    const idea = await Idea.create({
      text,
      type: 'wordcloud',
      session_id: session.id,
      votes: 0,
    });

    const updatedWords = await Idea.findAll({ where: { session_id: session.id, type: 'wordcloud' } });
    io.to(pin).emit('wordcloud-update', updatedWords);

    res.json({ status: 'success', idea });
  } catch (error) {
    console.error('Error al enviar idea:', error.message);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});


app.post('/api/generate-multiple-correct-questions', async (req, res, next) => {
  const { subtopic } = req.body;

  if (!subtopic || subtopic.trim() === '') {
    return res.status(400).json({ error: 'Debe proporcionar un subtema válido.' });
  }

  try {
    // Crear el prompt para OpenAI basado en el subtema
    const prompt = `
      Genera 3 preguntas cerradas en español basadas en el subtema: "${subtopic}". 
      Cada pregunta debe incluir 3 o más opciones de respuesta, con algunas de ellas correctas. 
      Las respuestas correctas deben estar marcadas con "(Correcta)" al final de la opción.
      Formato:
      Pregunta 1: Texto de la pregunta
      a) Opción 1
      b) Opción 2 (Correcta)
      c) Opción 3 (Correcta)
      d) Opción 4
      ...
    `;

    // Llamada a la API de OpenAI para generar las preguntas
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'Eres un asistente que genera preguntas cerradas educativas.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 500,
      temperature: 0.7,
    });

    // Obtener las preguntas generadas
    const questionsText = response.choices?.[0]?.message?.content?.trim();
    if (!questionsText) {
      throw new Error('La API no devolvió preguntas.');
    }

    // Procesar las preguntas generadas
    const questions = questionsText.split('\n\n').map((q, index) => {
      const [questionText, ...options] = q.split('\n').map((line) => line.trim());
      return {
        id: index + 1,
        text: questionText,
        options: options.map((option, idx) => ({
          id: idx + 1,
          text: option.replace(/^[a-d]\)\s*/, ''), // Eliminar prefijos como "a) "
          correct: option.includes('(Correcta)'), // Marcar la opción correcta si contiene "(Correcta)"
        })),
      };
    });

    // Guardar las preguntas en la base de datos (tabla Idea) como tipo 'pregunta'
    for (let question of questions) {
      // Guardar la pregunta principal
      const idea = await Idea.create({
        text: question.text,
        type: 'multiple-choice',  // Guardar como tipo 'pregunta'
        session_id: req.body.sessionId, // Asegúrate de que 'sessionId' esté en el cuerpo de la solicitud
      });

      // Guardar las opciones como ideas secundarias
      for (let option of question.options) {
        await Idea.create({
          text: option.text,
          type: 'opcion', // Opción de respuesta
          parent_id: idea.id,  // Vinculamos la opción a la pregunta principal
          session_id: req.body.sessionId, // Asegúrate de que 'sessionId' esté en el cuerpo de la solicitud
          correct: option.correct, // Marcamos si la opción es correcta
        });
      }
    }

    // Responder con las preguntas generadas
    res.json({ questions });
  } catch (error) {
    console.error('Error generando preguntas cerradas:', error.message);
    next(error);
  }
});


app.post('/api/generate-closed-questions', async (req, res, next) => {
  const { subtopic } = req.body;

  if (!subtopic || subtopic.trim() === '') {
    return res.status(400).json({ error: 'Debe proporcionar un subtema válido.' });
  }

  try {
    // Crear el prompt para OpenAI basado en el subtema
    const prompt = `
      Genera 3 preguntas cerradas en español basadas en el subtema: "${subtopic}".
      Cada pregunta debe incluir 3 opciones de respuesta, con solo una opción correcta.
      Formato:
      Pregunta 1: Texto de la pregunta
      a) Opción 1
      b) Opción 2 (Correcta)
      c) Opción 3
      ...
    `;

    // Llamada a la API de OpenAI para generar las preguntas
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'Eres un asistente que genera preguntas cerradas educativas.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 500,
      temperature: 0.7,
    });

    // Obtener las preguntas generadas
    const questionsText = response.choices?.[0]?.message?.content?.trim();
    if (!questionsText) {
      throw new Error('La API no devolvió preguntas.');
    }

    // Procesar las preguntas generadas
    const questions = questionsText.split('\n\n').map((q, index) => {
      const [questionText, ...options] = q.split('\n').map((line) => line.trim());
      return {
        id: index + 1,
        text: questionText,
        options: options.map((option, idx) => ({
          id: idx + 1,
          text: option.replace(/^[a-c]\)\s*/, ''), // Eliminar prefijos como "a) "
          correct: option.includes('(Correcta)'), // Marcar la opción correcta si contiene "(Correcta)"
        })),
      };
    });


    // Guardar las preguntas en la base de datos (tabla Idea) como tipo 'pregunta'
    for (let question of questions) {
      // Guardar la pregunta principal
      const idea = await Idea.create({
        text: question.text,
        type: 'close-question',  // Guardar como tipo 'pregunta'
        session_id: req.body.sessionId, // Asegúrate de que 'sessionId' esté en el cuerpo de la solicitud
      });

      // Guardar las opciones como ideas secundarias
      for (let option of question.options) {
        await Idea.create({
          text: option.text,
          type: 'opcion', // Opción de respuesta
          parent_id: idea.id,  // Vinculamos la opción a la pregunta principal
          session_id: req.body.sessionId, // Asegúrate de que 'sessionId' esté en el cuerpo de la solicitud
          correct: option.correct, // Marcamos si la opción es correcta
        });
      }
    }
    // Responder con las preguntas generadas
    res.json({ questions });
  } catch (error) {
    console.error('Error generando preguntas cerradas:', error.message);
    next(error);
  }
});



// Ruta para generar el ranking con OpenAI
app.post('/api/generate-questions', async (req, res, next) => {
  const { subtopic } = req.body; // Recibe solo el subtema

  if (!subtopic || subtopic.trim() === '') {
    return res.status(400).json({ error: 'Debe proporcionar un subtema válido para generar preguntas.' });
  }

  try {
    const prompt = `
      Genera 5 ideas (no más de 10 palabras) en español basadas en el subtema escogido:
      Subtema: "${subtopic}"
      Las ideas deben ser claras, relacionadas con el subtema, y adecuadas para un entorno educativo.
      No uses numeración ni prefijos como "-" tampoco pongas cosas como "ideas generadas" o algo parecido, solo generas las ideas y listo.
    `;

    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'Eres un asistente que genera ideas educativas.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 300,
      temperature: 0.7,
    });

    const questionsText = response.choices?.[0]?.message?.content?.trim();
    if (!questionsText) {
      throw new Error('La API no devolvió preguntas.');
    }

    // Dividir las preguntas en líneas y guardarlas
    const questions = questionsText
      .split('\n')
      .filter((question) => question.trim() !== '')
      .map((question) => ({ text: question.trim() }));

    // Guardar las preguntas en la base de datos
    const savedQuestions = await Promise.all(
      questions.map((question) =>
        Idea.create({
          text: question.text,
          session_id: null, // Asociado a sesión más tarde
          votes: 0,
          type: 'ranking', // Establecer el tipo de dinámica
        })
      )
    );

    res.json({
      questions: savedQuestions.map((idea) => ({ id: idea.id, text: idea.text })),
    });
  } catch (error) {
    console.error('Error generando preguntas:', error.message, error.response?.data || error);
    next(error);
  }
});

app.post('/api/generate-wordcloud', async (req, res, next) => {
  const { subtopic } = req.body; // Recibe solo el subtema

  if (!subtopic || subtopic.trim() === '') {
    return res.status(400).json({ error: 'Debe proporcionar un subtema válido para generar palabras.' });
  }

  try {
    const prompt = `
      Genera 10 palabras clave (no más de 2 palabras por idea) en español relacionadas con el subtema:
      Subtema: "${subtopic}"
      Las palabras deben ser claras, relacionadas con el subtema, y adecuadas para un entorno educativo. Reemplaza los numeros o algun prefijo como "-" con simplemente un espacio. 
    `;

    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'Eres un asistente que genera palabras clave educativas.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 150,
      temperature: 0.7,
    });

    const wordsText = response.choices?.[0]?.message?.content?.trim();
    if (!wordsText) {
      throw new Error('La API no devolvió palabras.');
    }

    const words = wordsText
      .split('\n')
      .filter((word) => word.trim() !== '')
      .map((word) => ({ text: word.trim(), votes: 0 }));

    // Guardar las palabras en la base de datos (opcional)
    const savedWords = await Promise.all(
      words.map((word) =>
        Idea.create({
          id: word.id,
          text: word.text,
          session_id: null, // Asociado a sesión más tarde
          votes: word.votes,
          type: 'wordcloud', // Establecer el tipo de dinámica
        })
      )
    );

    res.json({
      words: savedWords.map((word) => ({ id: word.id, text: word.text })),
    });
  } catch (error) {
    console.error('Error generando palabras:', error.message, error.response?.data || error);
    next(error);
  }
});


app.post('/api/assign-ideas-to-session', async (req, res, next) => {
  const { pin, ideas } = req.body; // Recibe el pin (session_id) y las ideas a asociar

  if (!pin || !ideas || ideas.length === 0) {
    return res.status(400).json({ error: 'Debe proporcionar un PIN y una lista de ideas.' });
  }

  try {
    const session = await Session.findOne({ where: { pin } });

    if (!session) {
      return res.status(404).json({ error: 'Sesión no encontrada.' });
    }

    // Actualizar las ideas con el session_id
    await Idea.update(
      { session_id: session.id },
      { where: { id: ideas.map((idea) => idea.id) } }
    );

    res.json({ message: 'Ideas asociadas a la sesión correctamente.' });
  } catch (error) {
    console.error('Error asociando ideas a la sesión:', error.message);
    next(error);
  }
});


// Ruta para generar subtemas basados en un tema
app.post('/api/generate-ideas', async (req, res, next) => {
  const { topic } = req.body;

  if (!topic || topic.trim() === '') {
    return res.status(400).json({ error: 'Debe proporcionar un tema válido.' });
  }

  try {
    const prompt = `
      Genera una lista de 7 subtemas (no más de 10 palabras) en español basados en el siguiente tema:
      Tema: "${topic}"
      Los subtemas deben ser claros, relevantes y relacionados con el tema.
      No uses numeración ni prefijos como "-", tampoco pongas cosas como "Subtemas generados" o algo parecido, solo generas los subtemas y listo.
    `;

    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'Eres un asistente que genera subtemas.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 300,
      temperature: 0.7,
    });

    const ideasText = response.choices?.[0]?.message?.content?.trim();
    if (!ideasText) {
      throw new Error('La API no devolvió subtemas.');
    }

    const subtopics = ideasText.split('\n').filter((idea) => idea.trim() !== '');

    // Guardar los subtemas en la base de datos con type: 'subtopic'
    const savedSubtopics = await Promise.all(
      subtopics.map((text) =>
        Idea.create({
          text: text.trim(),
          type: 'subtopic', // Diferenciar como subtemas
          session_id: null, // Sin sesión asociada
          votes: 0, // No se necesitan votos para subtemas
        })
      )
    );

    // Devuelve los subtemas en un formato uniforme
    res.json({ subtopics: savedSubtopics.map((idea) => ({ id: idea.id, title: idea.text })) });
  } catch (error) {
    console.error('Error generando subtemas:', error.message);
    next(error);
  }
});





app.get('/api/sessions/:pin', async (req, res) => {
  const { pin } = req.params;

  try {
    // Buscar la sesión en la base de datos
    const session = await Session.findOne({ where: { pin } });

    if (!session) {
      return res.status(404).json({ error: 'Sesión no encontrada.' });
    }

    // Devolver el tipo de sesión y el contenido del slide actual
    res.json({
      type: session.type,
      currentSlideContent: session.currentSlideContent, // Leer el contenido del slide actual
    });
  } catch (error) {
    console.error('Error al obtener la sesión:', error);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

app.put('/api/sessions/:pin/update-slide', async (req, res) => {
  const { pin } = req.params;
  const { currentSlideContent } = req.body;

  try {
    const session = await Session.findOne({ where: { pin } });
    if (!session) {
      return res.status(404).json({ error: 'Sesión no encontrada.' });
    }

    session.currentSlideContent = currentSlideContent; // Actualizar el contenido del slide
    await session.save();

    io.to(pin).emit('slide-update', currentSlideContent); // Emitir la actualización a los estudiantes
    res.json({ message: 'Slide actualizado correctamente.' });
  } catch (error) {
    console.error('Error al actualizar el slide:', error);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});



// Ruta para obtener ideas por sesión
app.get('/api/ideas/:sessionId', async (req, res, next) => {
  const { sessionId } = req.params;

  try {
    const session = await Session.findByPk(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Sesión no encontrada.' });
    }

    const ideas = await Idea.findAll({
      where: { session_id: sessionId },
    });

    res.json({ ideas });
  } catch (error) {
    console.error('Error al obtener ideas:', error.message, error.response?.data || error);
    next(error);
  }
});

// WebSocket para sincronización en tiempo real
io.on('connection', (socket) => {
  console.log('Usuario conectado');

  // Unirse a una sala
  socket.on('join-room', async (pin, participantId) => {
    console.log(`Evento join-room recibido con PIN: ${pin} y participantId: ${participantId}`);
    socket.join(pin);
    socket.data.room = pin;
    socket.data.participantId = participantId;

    const session = await Session.findOne({ where: { pin } });
    if (session) {
      // Enviar los participantes actuales al docente
      const participants = await Participant.findAll({ where: { session_id: session.id } });
      io.to(pin).emit('participants-updated', participants);

      // Enviar las ideas actuales si existen
      socket.emit('dynamic-change', session.type);
      const ideas = await Idea.findAll({ where: { session_id: session.id } });
      socket.emit('initialize-ideas', ideas);
    }
  });

  // Cambiar dinámica en tiempo real (docente)
  socket.on('change-dynamic', async ({ pin, dynamicType }) => {
    console.log(`Cambiando dinámica de la sala ${pin} a ${dynamicType}`);
    const session = await Session.findOne({ where: { pin } });
    if (!session) {
      return console.error(`Sesión con PIN ${pin} no encontrada.`);
    }

    // Actualizar dinámica en la base de datos
    session.type = dynamicType;
    await session.save();

    // Emitir cambio de dinámica a los estudiantes
    io.to(pin).emit('dynamic-change', dynamicType);
  });

  // Actualizar datos de la dinámica activa
  socket.on('update-dynamic-data', async ({ pin, data }) => {
    console.log(`Actualizando datos de la sala ${pin}`);
    const session = await Session.findOne({ where: { pin } });
    if (!session) {
      return console.error(`Sesión con PIN ${pin} no encontrada.`);
    }

    // Emitir los datos actualizados a todos en la sala
    io.to(pin).emit(`update-${session.type}`, data);
  });

  // Manejar solicitud de contenido inicial del slide
  socket.on('request-slide-content', async (pin, callback) => {
    try {
      const session = await Session.findOne({ where: { pin } });
      if (!session) {
        return callback({ status: 'error', error: 'Sesión no encontrada.' });
      }
      callback({ status: 'success', currentSlideContent: session.currentSlideContent });
    } catch (error) {
      console.error('Error al obtener contenido del slide:', error);
      callback({ status: 'error', error: 'Error al cargar el contenido del slide.' });
    }
  });
  // Votar por una palabra en el WordCloud
  // Emitir actualizaciones del WordCloud después de un voto
  socket.on('cast-vote-wordcloud', async ({ pin, wordId }, callback) => {
    try {
      if (typeof wordId !== 'number') {
        throw new Error('El ID de la palabra debe ser un número.');
      }

      const session = await Session.findOne({ where: { pin } });
      if (!session) {
        return callback({ status: 'error', error: 'Sesión no encontrada.' });
      }

      const word = await Idea.findOne({ where: { id: wordId, session_id: session.id, type:'wordcloud' } });
      if (!word) {
        return callback({ status: 'error', error: 'Palabra no encontrada.' });
      }

      // Incrementar los votos
      word.votes = (word.votes || 0) + 1;
      await word.save();

      // Emitir actualización a todos los clientes
      const updatedWords = await Idea.findAll({ where: { session_id: session.id, type:'wordcloud' } });
      io.to(pin).emit('wordcloud-update', updatedWords);

      callback({ status: 'success' });
    } catch (error) {
      console.error('Error procesando el voto:', error);
      callback({ status: 'error', error: 'No se pudo registrar tu voto.' });
    }
  });


  // Solicitar preguntas cerradas asociadas al PIN
  socket.on('request-questions', async ({ pin, type }, callback) => {
    try {
      // Buscar la sesión por PIN
      const session = await Session.findOne({ where: { pin } });
      if (!session) {
        return callback({ status: 'error', error: 'Sesión no encontrada.' });
      }
  
      // Obtener preguntas filtradas por tipo
      const questions = await Idea.findAll({
        where: {
          session_id: session.id,
          type, // Filtra directamente por el tipo de dinámica
        },
      });
  
      if (!questions || questions.length === 0) {
        return callback({ status: 'error', error: 'No se encontraron preguntas.' });
      }
  
      // Obtener las opciones relacionadas
      const questionsWithOptions = await Promise.all(
        questions.map(async (question) => {
          const options = await Idea.findAll({
            where: {
              parent_id: question.id,
              type: 'opcion',
            },
          });
  
          return {
            id: question.id,
            text: question.text,
            options: options.map((option) => ({
              id: option.id,
              text: option.text,
              correct: option.correct,
            })),
          };
        })
      );
  
      callback({ status: 'success', questions: questionsWithOptions });
    } catch (error) {
      console.error('Error al obtener preguntas:', error);
      callback({ status: 'error', error: 'No se pudieron cargar las preguntas.' });
    }
  });
  
  socket.on('submit-answers', async ({ pin, participantId, answers }, callback) => {
    try {
      // Buscar la sesión basada en el PIN
      const session = await Session.findOne({ where: { pin } });
      if (!session) {
        return callback({ status: 'error', error: 'Sesión no encontrada.' });
      }

      // Validar las respuestas enviadas
      const feedback = [];
      let score = 0;

      for (const questionId in answers) {
        const selectedOptionId = answers[questionId];

        // Buscar la pregunta
        const question = await Idea.findOne({
          where: { id: questionId, session_id: session.id, type: 'close-question' },
        });

        if (!question) {
          feedback.push({
            questionId,
            correct: false,
            correctAnswer: 'Pregunta no encontrada',
          });
          continue;
        }

        // Buscar la opción seleccionada por el estudiante
        const selectedOption = await Idea.findOne({
          where: { id: selectedOptionId, parent_id: question.id, type: 'opcion' },
        });

        if (selectedOption) {
          // Verificar si la opción es correcta
          if (selectedOption.correct) {
            score++;
            feedback.push({
              questionId,
              correct: true,
              correctAnswer: selectedOption.text,
            });
          } else {
            feedback.push({
              questionId,
              correct: false,
              correctAnswer: selectedOption.text,
            });
          }
        } else {
          feedback.push({
            questionId,
            correct: false,
            correctAnswer: 'Opción no válida',
          });
        }
      }
      console.log('Puntaje acumulado en close-question:', score); // Para depuración
      // Enviar retroalimentación al cliente con el puntaje y las respuestas correctas/incorrectas
      callback({
        status: 'success',
        feedback,
        score, // opcional: si quieres enviar el puntaje
      });

    } catch (error) {
      console.error('Error al procesar las respuestas:', error);
      callback({ status: 'error', error: 'Hubo un error procesando las respuestas.' });
    }
  });

  socket.on('submit-answers-multiple', async ({ pin, participantId, answers }, callback) => {
    try {
      // Buscar la sesión basada en el PIN
      const session = await Session.findOne({ where: { pin } });
      if (!session) {
        return callback({ status: 'error', error: 'Sesión no encontrada.' });
      }

      // Validar las respuestas enviadas
      const feedback = [];
      let score = 0;

      for (const questionId in answers) {
        const selectedOptionIds = answers[questionId]; // Puede ser un array de IDs si hay múltiples respuestas seleccionadas

        // Buscar la pregunta
        const question = await Idea.findOne({
          where: { id: questionId, session_id: session.id, type: 'multiple-choice' },
        });

        if (!question) {
          feedback.push({
            questionId,
            correct: false,
            correctAnswer: 'Pregunta no encontrada',
          });
          continue;
        }

        // Buscar las opciones correctas de la pregunta
        const correctOptions = await Idea.findAll({
          where: { parent_id: question.id, type: 'opcion', correct: true },
        });

        const correctOptionIds = correctOptions.map(option => option.id);

        // Contar las respuestas correctas e incorrectas
        let correctCount = 0;
        let incorrectCount = 0;

        selectedOptionIds.forEach(selectedOptionId => {
          if (correctOptionIds.includes(selectedOptionId)) {
            correctCount++;
          } else {
            incorrectCount++;
          }
        });

        // Calcular el puntaje según las condiciones
        if (incorrectCount === 0) { // No hay respuestas incorrectas
          if (correctCount === correctOptionIds.length) {
            score += 1; // Respuestas correctas todas, puntaje completo
          } else if (correctCount === 1 && correctOptionIds.length === 2) {
            score += 0.5; // Solo una respuesta correcta de dos posibles, puntaje medio
          }
        }

        feedback.push({
          questionId,
          correctCount,
          incorrectCount,
          correctAnswer: correctOptions.map(option => option.text).join(', '),
        });
      }

      // Enviar retroalimentación al cliente con el puntaje y las respuestas correctas/incorrectas
      callback({
        status: 'success',
        feedback,
        score, // puntaje calculado
      });

    } catch (error) {
      console.error('Error al procesar las respuestas:', error);
      callback({ status: 'error', error: 'Hubo un error procesando las respuestas.' });
    }
  });


  socket.on('request-ideas', async (pin, type, callback) => {
    try {
      const session = await Session.findOne({ where: { pin } });
      if (!session) {
        return callback({ status: 'error', error: 'Sesión no encontrada.' });
      }
  
      // Validar el tipo proporcionado
      if (!['ranking', 'wordcloud'].includes(type)) {
        return callback({ status: 'error', error: 'Tipo de dinámica no válido.' });
      }
  
      // Obtener ideas filtradas por tipo
      const ideas = await Idea.findAll({
        where: { session_id: session.id, type },
      });
  
      callback({ status: 'success', ideas });
    } catch (error) {
      console.error('Error al obtener ideas:', error);
      callback({ status: 'error', error: 'No se pudieron cargar las ideas.' });
    }
  });
  

  // Enviar ideas (para Brainstorm)
  socket.on('send-idea', async ({ pin, idea, participantId }, callback) => {
    console.log(`Idea recibida: "${idea}" para PIN ${pin} de participante ${participantId}`);
    try {
      const session = await Session.findOne({ where: { pin } });
      if (!session) {
        return callback({ status: 'error', error: 'Sesión no encontrada.' });
      }
  
      // Busca si la idea ya existe para esta sesión (case insensitive)
      const existingIdea = await Idea.findOne({
        where: {
          session_id: session.id,
          type: 'wordcloud',
          text: { [Op.iLike]: idea }, // Compara sin importar mayúsculas/minúsculas
        },
      });
  
      if (existingIdea) {
        // Si la idea ya existe, incrementa su tamaño (votos)
        existingIdea.votes += 1;
        await existingIdea.save();
      } else {
        // Si no existe, crea una nueva idea
        await Idea.create({
          text: idea,
          session_id: session.id,
          type: 'wordcloud',
          votes: 1, // Tamaño inicial
        });
      }
  
      // Emitir las ideas actualizadas a todos los clientes
      const updatedIdeas = await Idea.findAll({
        where: { session_id: session.id, type: 'wordcloud' },
      });
      io.to(pin).emit('wordcloud-update', updatedIdeas);
  
      callback({ status: 'success' });
    } catch (error) {
      console.error(`Error procesando la idea para PIN ${pin}:`, error);
      callback({ status: 'error', error: 'Error interno del servidor.' });
    }
  });
  
  
  

  // Votar por una idea (para Ranking)
  socket.on('cast-vote', async ({ pin, ideaId, participantId }, callback) => {
    console.log(`Voto recibido para ideaId: ${ideaId} en PIN: ${pin} de participante ${participantId}`);
    try {
      const session = await Session.findOne({ where: { pin } });
      if (!session) {
        return callback({ status: 'error', error: 'Sesión no encontrada.' });
      }

      const idea = await Idea.findOne({ where: { id: ideaId, session_id: session.id, type:'ranking' } });
      if (!idea) {
        return callback({ status: 'error', error: 'Idea no encontrada.' });
      }

      // Actualizar votos
      idea.votes = (idea.votes || 0) + 1;
      await idea.save();

      // Emitir actualización a todos los usuarios en la sala
      const updatedIdeas = await Idea.findAll({ where: { session_id: session.id, type: 'ranking' } });
      io.to(pin).emit('vote-update', updatedIdeas);

      // Confirmar al cliente
      callback({ status: 'success' });
    } catch (error) {
      console.error('Error procesando el voto:', error);
      callback({ status: 'error', error: 'No se pudo registrar tu voto.' });
    }
  });

  // Solicitar ranking actual
  socket.on('request-ranking-data', async ({ pin }, callback) => {
    try {
      const session = await Session.findOne({ where: { pin } });
      if (!session) return callback({ status: 'error', error: 'Sesión no encontrada.' });

      const rankingData = await Idea.findAll({ where: { session_id: session.id } });
      callback(rankingData);
    } catch (error) {
      console.error('Error al solicitar ranking:', error);
      callback([]);
    }
  });

  // Manejar actualizaciones del slide desde el presentador
  socket.on('slide-update', async ({ pin, currentSlideContent, type }) => {
    try {
      const session = await Session.findOne({ where: { pin } });
      if (!session) {
        console.error(`Sesión con PIN ${pin} no encontrada.`);
        return;
      }
  
      // Actualizar el contenido del slide y el tipo de dinámica en la base de datos
      session.currentSlideContent = currentSlideContent;
      session.type = type; // Actualiza el tipo de dinámica
      await session.save();
  
      // Emitir el contenido actualizado y tipo a todos los usuarios de la sala
      io.to(pin).emit('slide-update', { content: currentSlideContent, type });
      console.log(`Slide actualizado en la sala ${pin}:`, currentSlideContent, `Tipo: ${type}`);
    } catch (error) {
      console.error('Error al procesar slide-update:', error.message);
    }
  });
  

  // Manejar evento de abandono de sala
  socket.on('leave-room', async (pin, participantId) => {
    try {
      socket.leave(pin);
      console.log(`Participante ${participantId} abandonó la sala ${pin}`);

      // Eliminar participante de la base de datos
      if (participantId) {
        await Participant.destroy({ where: { id: participantId } });
      }

      // Notificar al presentador sobre los participantes actualizados
      const session = await Session.findOne({ where: { pin } });
      if (session) {
        const participants = await Participant.findAll({ where: { session_id: session.id } });
        io.to(pin).emit('participants-updated', participants);
      }
    } catch (error) {
      console.error('Error al procesar leave-room:', error.message);
    }
  });

  // Desconexión
  socket.on('disconnect', async () => {
    console.log('Usuario desconectado');
    const room = socket.data.room;
    const participantId = socket.data.participantId;

    if (room && participantId) {
      try {
        // Eliminar al participante de la base de datos
        await Participant.destroy({ where: { id: participantId } });

        const session = await Session.findOne({ where: { pin: room } });
        if (session) {
          // Emitir lista actualizada de participantes al docente
          const participants = await Participant.findAll({ where: { session_id: session.id } });
          io.to(room).emit('participants-updated', participants);
        }
      } catch (error) {
        console.error('Error al procesar la desconexión:', error);
      }
    }
  });
});


// Middleware global para manejo de errores
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'Error interno del servidor',
  });
});

// Iniciar servidor
server.listen(3000, () => {
  console.log('Servidor ejecutándose en http://localhost:3000');
});
