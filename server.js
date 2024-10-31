require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const app = express();
const { format } = require('date-fns');
const { ptBR } = require('date-fns/locale');

app.use(express.json());
app.use(cors());

// Configuração do MySQL com Pool de Conexões
const db = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'root',
  database: process.env.DB_NAME || 'sjd-bd',
});

app.post('/register', async (req, res) => {
  const { email, cpf, telefone, nome_completo, senha, role } = req.body;

  if (!email || !cpf || !telefone || !nome_completo || !senha || !role) {
    return res.status(400).json({ error: 'Todos os campos são obrigatórios.' });
  }

  try {
    const [[{ count }]] = await db.query('SELECT COUNT(*) AS count FROM usuarios WHERE email = ?', [email]);

    if (count > 0) {
      return res.status(400).json({ error: 'Usuário já existe' });
    }

    const hashedPassword = await bcrypt.hash(senha, 10);
    const [result] = await db.query(
      'INSERT INTO usuarios (email, cpf, telefone, nome_completo, senha, role) VALUES (?, ?, ?, ?, ?, ?)',
      [email, cpf, telefone, nome_completo, hashedPassword, role]
    );

    if (!result.insertId) {
      throw new Error('Erro ao inserir usuário no banco de dados.');
    }

    let redirectUrl = '';
    if (role === 'juiz') redirectUrl = '/home-juiz';
    else if (role === 'cidadao') redirectUrl = '/home-cidadao';
    else if (role === 'promotor') redirectUrl = '/home-promotor';

    return res.status(201).json({ message: 'Usuário cadastrado com sucesso!', redirectUrl, userId: result.insertId });
  } catch (error) {
    console.error('Erro no registro:', error);
    res.status(500).json({ error: `Erro no servidor durante o registro: ${error.message}` });
  }
});


// Rota de Login de Usuário
app.post('/login', async (req, res) => {
  const { email, senha } = req.body;

  try {
    const [results] = await db.query('SELECT * FROM usuarios WHERE email = ?', [email]);

    if (results.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const user = results[0];
    const isMatch = await bcrypt.compare(senha, user.senha);
    if (!isMatch) return res.status(400).json({ error: 'Senha incorreta' });

    let redirectUrl = '';
    if (user.role === 'juiz') redirectUrl = '/home-juiz';
    else if (user.role === 'cidadao') redirectUrl = '/home-cidadao';
    else if (user.role === 'promotor') redirectUrl = '/home-promotor';

    res.status(200).json({
      message: 'Login realizado com sucesso',
      userId: user.id,
      redirectUrl,
    });
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: 'Erro no servidor durante o login' });
  }
});

// Rota para buscar dados do usuário
app.get('/api/usuario/:id', async (req, res) => {
  const userId = req.params.id;

  try {
    const [results] = await db.query('SELECT email, cpf, telefone, nome_completo FROM usuarios WHERE id = ?', [userId]);

    if (results.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    const user = results[0];
    res.status(200).json({
      email: user.email,
      cpf: user.cpf,
      telefone: user.telefone,
      nome_completo: user.nome_completo,
    });
  } catch (error) {
    console.error('Erro ao buscar dados do usuário:', error);
    res.status(500).json({ error: 'Erro ao buscar dados do usuário.' });
  }
});

// Rota para atualizar a senha do usuário
app.put('/api/usuario/:id/senha', async (req, res) => {
  const userId = req.params.id;
  const { senha } = req.body;

  if (!senha) {
    return res.status(400).json({ error: 'A nova senha é obrigatória.' });
  }

  try {
    const hashedPassword = await bcrypt.hash(senha, 10);

    const [result] = await db.query('UPDATE usuarios SET senha = ? WHERE id = ?', [hashedPassword, userId]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }
    res.status(200).json({ message: 'Senha atualizada com sucesso.' });
  } catch (error) {
    console.error('Erro ao atualizar senha:', error);
    res.status(500).json({ error: 'Erro no servidor durante a atualização da senha.' });
  }
});

// Rota para obter todas as audiências
app.get('/api/audiencias', async (req, res) => {
  try {
    const [audiencias] = await db.query('SELECT * FROM audiencias');
    res.status(200).json(audiencias);
  } catch (error) {
    console.error('Erro ao buscar audiências:', error);
    res.status(500).json({ error: 'Erro ao buscar audiências' });
  }
});

app.post('/api/audiencias/gerenciar/criar', async (req, res) => {
  const { id_juiz, data_audiencia, local, descricao, participantes, tipo_participante } = req.body;

  if (!id_juiz || !data_audiencia || !local || !tipo_participante || !participantes || participantes.length === 0) {
    return res.status(400).json({ error: 'Todos os campos são obrigatórios e a lista de participantes não pode estar vazia.' });
  }

  const connection = await db.getConnection(); // Obtenha a conexão do pool
  try {
    await connection.beginTransaction();

    const formattedData = format(new Date(data_audiencia), 'yyyy-MM-dd HH:mm:ss');
    const [result] = await connection.query(
      'INSERT INTO audiencias (data_audiencia, local, descricao, id_juiz, tipo_participante) VALUES (?, ?, ?, ?, ?)',
      [formattedData, local, descricao, id_juiz, tipo_participante]
    );

    const audienciaId = result.insertId;

    for (const participanteId of participantes) {
      await connection.query(
        'INSERT INTO audiencia_participantes (id_audiencia, id_participante) VALUES (?, ?)',
        [audienciaId, participanteId]
      );
    }

    await connection.commit();
    res.status(201).json({ message: 'Audiência criada com sucesso!', audienciaId });
  } catch (error) {
    await connection.rollback();
    console.error('Erro ao criar audiência:', error);
    res.status(500).json({ error: 'Erro ao criar audiência' });
  } finally {
    connection.release(); // Libere a conexão para o pool
  }
});


app.get('/api/participantes', async (req, res) => {
  try {
    const [participantes] = await db.query('SELECT id, nome_completo FROM usuarios WHERE tipo_usuario = ?', ['cidadao']);
    res.status(200).json(participantes);
  } catch (error) {
    console.error('Erro ao buscar participantes:', error);
    res.status(500).json({ error: 'Erro ao buscar participantes.' });
  }
});


// Porta do servidor
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
