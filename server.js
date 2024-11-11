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

// Rota de Registro para Juízes e Funcionários Públicos
app.post('/register', async (req, res) => {
  const { nome, email, cpf, senha, role, cargo, departamento } = req.body;

  if (!nome || !email || !cpf || !senha || !role) {
    return res.status(400).json({ error: 'Todos os campos obrigatórios devem ser preenchidos.' });
  }

  try {
    let query, values;

    if (role === 'juiz') {
      query = 'INSERT INTO juizes (nome, email, cpf, senha, role_id) VALUES (?, ?, ?, ?, (SELECT id FROM roles WHERE nome_role = ?))';
      values = [nome, email, cpf, await bcrypt.hash(senha, 10), 'juiz'];
    } else if (role === 'funcionario_publico') {
      query = 'INSERT INTO funcionarios_publicos (nome, email, cpf, senha, cargo, departamento, role_id) VALUES (?, ?, ?, ?, ?, ?, (SELECT id FROM roles WHERE nome_role = ?))';
      values = [nome, email, cpf, await bcrypt.hash(senha, 10), cargo, departamento, 'funcionario_publico'];
    } else {
      return res.status(400).json({ error: 'Role inválido.' });
    }

    const [result] = await db.query(query, values);

    if (!result.insertId) {
      throw new Error('Erro ao inserir usuário no banco de dados.');
    }

    res.status(201).json({ message: 'Usuário cadastrado com sucesso!', userId: result.insertId });
  } catch (error) {
    console.error('Erro no registro:', error);
    res.status(500).json({ error: `Erro no servidor durante o registro: ${error.message}` });
  }
});

// Rota de Login
app.post('/login', async (req, res) => {
  const { email, senha } = req.body;

  try {
    // Consulta para buscar o usuário pelo email
    const [user] = await db.query(
      `SELECT id, nome, email, senha, role_id 
       FROM juizes WHERE email = ? 
       UNION 
       SELECT id, nome, email, senha, role_id 
       FROM funcionarios_publicos WHERE email = ?`,
      [email, email]
    );

    // Verificação se o usuário foi encontrado
    if (user.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const usuario = user[0];  // O primeiro registro da consulta
    const isMatch = await bcrypt.compare(senha, usuario.senha);

    // Verificação de senha
    if (!isMatch) {
      return res.status(400).json({ error: 'Senha incorreta' });
    }

    // Lógica de redirecionamento com base no role_id
    const redirectUrl = usuario.role_id === 1 ? '/home-juiz' : '/home-funcionario';

    res.status(200).json({
      message: 'Login realizado com sucesso',
      userId: usuario.id,
      redirectUrl,
    });
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: 'Erro no servidor durante o login' });
  }
});


// Rota para Criar Audiências (Exclusivo para Juízes)
app.post('/api/audiencias/gerenciar/criar', async (req, res) => {
  const { id_juiz, data_audiencia, local, descricao, participantes } = req.body;

  if (!id_juiz || !data_audiencia || !local || !participantes || participantes.length === 0) {
    return res.status(400).json({ error: 'Todos os campos obrigatórios e lista de participantes não pode estar vazia.' });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const formattedData = format(new Date(data_audiencia), 'yyyy-MM-dd HH:mm:ss', { locale: ptBR });
    const [result] = await connection.query(
      'INSERT INTO audiencias (data_audiencia, local, descricao, id_juiz) VALUES (?, ?, ?, ?)',
      [formattedData, local, descricao, id_juiz]
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
    connection.release();
  }
});

// Porta do servidor
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
