import os
import psycopg2
from dotenv import load_dotenv

load_dotenv()

DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "postgres")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "postgres")

def verify():
    try:
        conn = psycopg2.connect(
            host=DB_HOST,
            port=DB_PORT,
            dbname=DB_NAME,
            user=DB_USER,
            password=DB_PASSWORD
        )
        with conn:
            with conn.cursor() as cursor:
                cursor.execute("SELECT count(*) FROM stories")
                stories = cursor.fetchone()[0]
                
                cursor.execute("SELECT count(*) FROM chapters")
                chapters = cursor.fetchone()[0]
                
                cursor.execute("SELECT count(*) FROM chapter_blocks")
                blocks = cursor.fetchone()[0]
                
                cursor.execute("SELECT count(*) FROM block_embeddings")
                embeddings = cursor.fetchone()[0]
                
                print(f"Stories: {stories}")
                print(f"Chapters: {chapters}")
                print(f"Blocks: {blocks}")
                print(f"Embeddings: {embeddings}")
                
    except Exception as e:
        print(f"Error verifying DB: {e}")

if __name__ == "__main__":
    verify()
